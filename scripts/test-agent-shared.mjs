import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.loadEnvFile("/tmp/origin-integration-qa.env");
const site = process.env.ORIGIN_PUBLIC_URL, backend = process.env.NEXT_PUBLIC_CONVEX_URL;
for (const url of [site, backend]) assert.equal(new URL(url).hostname, "127.0.0.1", "Local synthetic QA only");
const { alex, sam, viewer, workspace, projectId } = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
async function request(route, user, body, status = 200) {
  const response = await fetch(`${site}/api/${route}${route.includes("?") ? "&" : "?"}teamId=${workspace._id}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${typeof user === "string" ? user : user.sessionToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify({ teamId: workspace._id, ...body }) } : {}) });
  const data = await response.json(); assert.equal(response.status, status, data.error); return data;
}
const post = (body, who = alex, status = 200) => request("agent", who, body, status);
const snapshot = (threadId, who = alex, status = 200) => request(`agent${threadId ? `?threadId=${threadId}` : ""}`, who, undefined, status);
const previous = (await snapshot()).settings;
const pair = await post({ op: "pair", write: true, extended: true });
const device = await post({ op: "pair-device", code: pair.code, name: "Shared synthetic QA" });
try {
  const shared = { ...previous, mode: "companion", location: "server", sharedDeviceId: device.deviceId, model: "gpt-6-luna", reasoning: "default" };
  await post({ op: "settings", settings: shared }, sam, 400);
  await post({ op: "settings", settings: shared });
  const dm = await request("local-chat/conversations", alex, { recipientId: viewer.user._id });
  await request(`local-chat/messages?conversation=${encodeURIComponent(dm.conversationId)}`, alex, { body: "PRIVATE OWNER CONTENT" });
  const memberJob = await post({ op: "send", prompt: "Read my work only", consent: true }, sam);
  await snapshot(memberJob.threadId, alex, 400);
  const claim = (await post({ op: "poll" }, device.token)).job;
  assert.equal(claim.model, "gpt-6-luna"); assert.equal(claim.reasoning, "default");
  assert.ok(!("sealedScope" in claim));
  const tool = (args, status = 200) => post({ op: "tool", jobId: memberJob.jobId, callId: `test-${args.kind}`, name: "origin_read", args }, device.token, status);
  await tool({ kind: "project", projectId }, 400);
  const conversations = JSON.parse((await tool({ kind: "conversations" })).result).conversations;
  assert.ok(!conversations.some(c => c.id === dm.conversationId));
  await tool({ kind: "messages", conversationId: dm.conversationId }, 400);
  await tool({ kind: "invitations" }, 400);
  await post({ op: "progress", jobId: memberJob.jobId, status: "completed", response: "Scoped correctly" }, device.token);
  const viewerJob = await post({ op: "send", prompt: "Read-only", consent: true }, viewer);
  await post({ op: "poll" }, device.token);
  await post({ op: "tool", jobId: viewerJob.jobId, callId: "viewer-write", name: "origin_change", args: { kind: "create_project", name: "Forbidden" } }, device.token, 400);
  await post({ op: "stop", jobId: viewerJob.jobId }, viewer);
  const format = await post({ op: "format", projectId, text: "some text", consent: true });
  await post({ op: "poll" }, device.token);
  await post({ op: "tool", jobId: format.jobId, callId: "format-read", name: "origin_read", args: { kind: "projects" } }, device.token, 400);
  await post({ op: "progress", jobId: format.jobId, status: "completed", response: "## Clear text" }, device.token);
  assert.ok(!(await snapshot()).threads.some(t => t.id === format.threadId));
  assert.equal((await snapshot(format.threadId)).jobs[0].response, "## Clear text");
  const pending = await post({ op: "send", prompt: "Cancel me", consent: true }, sam);
  await post({ op: "settings", settings: { ...shared, enabled: false } });
  assert.equal((await snapshot(pending.threadId, sam)).jobs[0].status, "cancelled");
  await post({ op: "send", prompt: "Disabled", consent: true }, sam, 400);
  console.log("PASS shared runner isolation, private DMs/projects, viewer permissions, format tool isolation, hidden format history and workspace disable");
  await post({ op: "settings", settings: previous });
  const readPair = await post({ op: "pair", write: false, extended: true });
  const readonly = await post({ op: "pair-device", code: readPair.code, name: "Read-only extended QA" });
  const readJob = await post({ op: "send", deviceId: readonly.deviceId, prompt: "Read only despite consent", consent: true });
  await post({ op: "poll" }, readonly.token);
  await post({ op: "tool", jobId: readJob.jobId, callId: "consented-readonly", name: "origin_change", args: { kind: "create_project", name: "Forbidden" } }, readonly.token, 400);
  await post({ op: "disconnect", deviceId: readonly.deviceId });
  console.log("PASS extended consent does not escalate a read-only companion");
} finally {
  await post({ op: "settings", settings: previous });
  await post({ op: "disconnect", deviceId: device.deviceId });
}
