import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";

process.loadEnvFile("/tmp/origin-integration-qa.env");
const site = process.env.ORIGIN_PUBLIC_URL;
assert.equal(new URL(site).hostname, "127.0.0.1", "Synthetic localhost only");
assert.ok(process.env.ORIGIN_SMOKE_AUTH_FILE, "Explicitly provide an authorized companion auth file");
const f = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
async function api(body, threadId) {
  const response = await fetch(`${site}/api/agent?teamId=${f.workspace._id}${threadId ? `&threadId=${threadId}` : ""}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${f.alex.sessionToken}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify({ ...body, teamId: f.workspace._id }) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
const home = await mkdtemp(path.join(tmpdir(), "origin-agent-smoke-"));
const root = path.join(home, ".origin-agent", createHash("sha256").update(site).digest("hex").slice(0, 16));
await mkdir(path.join(root, "codex"), { recursive: true, mode: 0o700 });
await copyFile(process.env.ORIGIN_SMOKE_AUTH_FILE, path.join(root, "codex", "auth.json"));
let child, deviceId;
let stopping = false;
async function cleanup() {
  if (stopping) return; stopping = true;
  if (deviceId) await api({ op: "disconnect", deviceId }).catch(() => {});
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void cleanup().then(() => process.exit()));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const pair = await api({ op: "pair", write: true, extended: true });
  child = spawn(process.execPath, ["public/agent/origin-agent.mjs", "--origin", site, "--pair", pair.code], { env: { ...process.env, HOME: home, ORIGIN_AGENT_NAME: "Isolated Luna smoke test" }, stdio: ["ignore", "inherit", "inherit"] });
  for (let i = 0; i < 60; i++) {
    deviceId = (await api()).devices.find(d => d.name === "Isolated Luna smoke test")?.id;
    if (deviceId) break;
    if (child.exitCode !== null) throw new Error("Companion exited during setup");
    await pause(1000);
  }
  assert.ok(deviceId, "Companion must pair");
  async function complete(body) {
    const queued = await api(body);
    for (let i = 0; i < 120; i++) {
      const data = await api(undefined, queued.threadId);
      const job = data.jobs.find(j => j.id === queued.jobId);
      if (job.status === "failed") throw new Error(job.error);
      if (job.status === "completed") { assert.equal(job.model, "gpt-6-luna"); assert.equal(job.reasoning, "default"); assert.ok(job.response.trim()); return job.response; }
      await pause(1000);
    }
    throw new Error("Smoke test timed out");
  }
  const read = await complete({ op: "send", deviceId, consent: true, prompt: "Use origin_read to list the projects I can access. Return only their names. Do not propose or change anything." });
  assert.match(read, /Website/);
  console.log("PASS real GPT Luna response with live scoped project tool");
  const formatted = await complete({ op: "format", consent: true, projectId: f.projectId, text: "fix mobile nav. keep colors. test small screens then desktop." });
  assert.match(formatted, /mobile|Mobile/);
  console.log("PASS real GPT Luna issue formatting, default reasoning, no API key");
  if (process.argv.includes("--serve")) { console.log("Ready for browser formatting QA; stop with Ctrl+C."); await new Promise(resolve => child.once("exit", resolve)); }
} finally { await cleanup(); }
