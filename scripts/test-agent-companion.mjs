import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexConnection, parseOptions, runJob } from "../public/agent/origin-agent.mjs";

test("setup options reject incomplete, ambiguous and malformed commands", () => {
  assert.throws(() => parseOptions(["--origin"]), /needs a value/);
  assert.throws(() => parseOptions(["--pair", "--login"]), /needs a value/);
  assert.throws(() => parseOptions(["--pair", "old-code"]), /Invalid pairing/);
  assert.throws(() => parseOptions(["--unknown"]), /Unknown option/);
  assert.throws(() => parseOptions(["--pair", "a".repeat(48), "--login"]), /separately/);
  assert.deepEqual(parseOptions(["--origin", "https://origin.example", "--check"]), { origin: "https://origin.example", check: true });
});

test("missing Codex reports installation instructions instead of a raw ENOENT", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
  const rpc = new CodexConnection(child);
  const pending = rpc.request("initialize");
  child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }));
  await assert.rejects(pending, /npm install -g @openai\/codex/);
});

test("JSONL transport matches responses and fails promptly on process exit", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
  const rpc = new CodexConnection(child);
  const result = rpc.request("initialize");
  child.stdout.write('{"id":1,"result":{"ok":true}}\n');
  assert.deepEqual(await result, { ok: true });
  const pending = rpc.request("account/read");
  child.emit("exit", 1);
  await assert.rejects(pending, /disconnected/);
  await assert.rejects(rpc.request("thread/start"), /disconnected/);
});

test("shutdown waits for Codex to exit and repeated closes share the same wait", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.pid = 123; child.exitCode = null; child.signalCode = null;
  const signals = []; child.kill = signal => { signals.push(signal); return true; };
  const rpc = new CodexConnection(child);
  let closed = false;
  const closing = rpc.close(); closing.then(() => { closed = true; });
  assert.equal(rpc.close(), closing);
  await Promise.resolve();
  assert.equal(closed, false);
  assert.deepEqual(signals, ["SIGTERM"]);
  child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM");
  await closing;
  assert.equal(closed, true);
  await rpc.close();
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("shutdown does not signal an already exited or unstarted process", async () => {
  for (const state of [{ pid: undefined, exitCode: null, signalCode: null }, { pid: 123, exitCode: 0, signalCode: null }]) {
    const child = Object.assign(new EventEmitter(), state); child.stdout = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => assert.fail("Process is no longer running");
    await new CodexConnection(child).close();
  }
});

function mockRpc(onTurn) {
  const rpc = { listeners: new Set(), requests: [], sent: [], send: message => rpc.sent.push(message), emit: message => { for (const fn of rpc.listeners) fn(message); }, async request(method, params) {
    rpc.requests.push({ method, params });
    if (method === "model/list") return { data: [{ id: "gpt-6-luna", model: "gpt-6-luna", defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }] }] };
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread-1" } };
    if (method === "turn/start") { onTurn(rpc); return { turn: { id: "turn-1" } }; }
    return {};
  } };
  return rpc;
}
const job = { id: "job-1", prompt: "Review my work", skill: "workspace" };
test("formatter starts without workspace tools and unsupported models never silently fall back", async () => {
  const rpc = mockRpc(r => r.emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { status: "completed" } } }));
  await runJob(rpc, { ...job, skill: "format" }, [{ name: "origin_change", inputSchema: {} }], async () => ({ status: "running" }));
  assert.deepEqual(rpc.requests.find(r => r.method === "thread/start").params.dynamicTools, []);
  const invalid = mockRpc(() => assert.fail("Unavailable models must not run"));
  await assert.rejects(runJob(invalid, { ...job, model: "missing-model" }, [], async () => ({ status: "running" })), /not available/);
  await assert.rejects(runJob(invalid, { ...job, reasoning: "max" }, [], async () => ({ status: "running" })), /not supported/);
});
test("captures completion before turn/start resolves and uses only scoped workspace tools", async () => {
  const requests = [];
  const rpc = mockRpc(r => {
    r.emit({ method: "item/agentMessage/delta", params: { threadId: "thread-1", delta: "Your summary" } });
    r.emit({ method: "turn/completed", params: { threadId: "thread-1", turn: { status: "completed" } } });
  });
  await runJob(rpc, job, [{ name: "origin_read", description: "Read", inputSchema: {} }], async body => { requests.push(body); return { status: "running" }; });
  assert.equal(requests.at(-1).response, "Your summary");
  assert.equal(requests.at(-1).status, "completed");
  const start = rpc.requests.find(r => r.method === "thread/start").params;
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.config["features.shell_tool"], false);
  assert.equal(start.dynamicTools[0].type, "function");
  assert.equal(start.model, "gpt-6-luna");
  assert.equal(rpc.requests.find(r => r.method === "turn/start").params.effort, "medium");
  assert.equal(rpc.listeners.size, 0);
});
test("fails a running request promptly when Codex exits", async () => {
  const rpc = mockRpc(r => r.emit({ method: "origin/disconnected", params: { message: "Codex disconnected" } }));
  const requests = [];
  await assert.rejects(runJob(rpc, job, [], async body => { requests.push(body); return { status: "running" }; }), /disconnected/);
  assert.equal(requests.at(-1).status, "failed");
  assert.equal(rpc.listeners.size, 0);
});
test("does not start a model turn after cancellation during setup", async () => {
  const rpc = mockRpc(() => assert.fail("Turn must not start"));
  await runJob(rpc, job, [], async () => ({ status: "cancelled" }));
  assert.equal(rpc.requests.some(r => r.method === "turn/start"), false);
});
test("rejects unrelated tools and local command execution", async () => {
  const rpc = mockRpc(r => {
    r.emit({ id: 10, method: "item/tool/call", params: { tool: "unrelated_tool", callId: "bad" } });
    r.emit({ id: 11, method: "item/commandExecution/requestApproval", params: {} });
    r.emit({ method: "turn/completed", params: { turn: { status: "completed" } } });
  });
  await runJob(rpc, job, [], async () => ({ status: "running" }));
  assert.equal(rpc.sent.find(m => m.id === 10).result.success, false);
  assert.equal(rpc.sent.find(m => m.id === 11).result.decision, "decline");
});
test("returns a pending proposal promptly instead of holding the provider call for human consent", async () => {
  const calls = [];
  const rpc = mockRpc(r => {
    r.send = message => { r.sent.push(message); if (message.id === 12) r.emit({ method: "turn/completed", params: { turn: { status: "completed" } } }); };
    r.emit({ id: 12, method: "item/tool/call", params: { tool: "origin_change", callId: "proposal", arguments: { kind: "create_project", name: "Test" } } });
  });
  await runJob(rpc, job, [], async body => { calls.push(body); return body.op === "tool" ? { status: "pending", approvalId: "exact-proposal" } : { status: "running" }; });
  assert.equal(calls.filter(call => call.op === "tool").length, 1);
  assert.equal(JSON.parse(rpc.sent.find(m => m.id === 12).result.contentItems[0].text).status, "awaiting_approval");
  assert.equal(calls.at(-1).status, "completed");
});
