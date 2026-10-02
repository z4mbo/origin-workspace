import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

process.loadEnvFile("/tmp/origin-integration-qa.env");
const site = process.env.ORIGIN_PUBLIC_URL;
const backend = process.env.NEXT_PUBLIC_CONVEX_URL;
for (const url of [site, backend]) assert.equal(new URL(url).hostname, "127.0.0.1", "Only isolated localhost is allowed");
const { alex, sam, viewer, workspace, projectId } = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
const convex = new ConvexHttpClient(backend, { logger: false });
const query = (name, args) => convex.query(makeFunctionReference(name), args);
const mutation = (name, args) => convex.mutation(makeFunctionReference(name), args);
const scope = { teamId: workspace._id };
async function post(body, token = alex.sessionToken, expected = 200) {
  const response = await fetch(`${site}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...scope, ...body }) });
  const data = await response.json(); assert.equal(response.status, expected, data.error); return data;
}
async function snapshot(threadId, token = alex.sessionToken, expected = 200) {
  const response = await fetch(`${site}/api/agent?teamId=${workspace._id}${threadId ? `&threadId=${threadId}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json(); assert.equal(response.status, expected, data.error); return data;
}
const connections = [];
try {
  await post({ op: "pair", write: true }, viewer.sessionToken, 400);
  const pair = await post({ op: "pair", write: true });
  const device = await post({ op: "pair-device", code: pair.code, name: "Workflow QA" }); connections.push(device);
  await post({ op: "pair-device", code: pair.code, name: "Replay" }, "", 400);
  await post({ op: "poll" }, "invalid", 400);
  assert.equal((await post({ op: "poll" }, device.token)).job, null);
  await post({ op: "send", deviceId: device.deviceId, prompt: "Forbidden", skill: "workspace" }, sam.sessionToken, 400);
  const job = await post({ op: "send", deviceId: device.deviceId, projectId, prompt: "Create a test issue", skill: "workspace" });
  await snapshot(job.threadId, sam.sessionToken, 400);
  const claimed = await post({ op: "poll" }, device.token);
  assert.equal(claimed.job.id, job.jobId);
  assert.deepEqual(claimed.tools.map(t => t.name), ["origin_read", "origin_change"]);
  const read = await post({ op: "tool", jobId: job.jobId, callId: "read-1", name: "origin_read", args: { kind: "project", projectId } }, device.token);
  const project = JSON.parse(read.result);
  assert.ok(project.columns.length);
  const title = `Agent workflow QA ${Date.now()}`;
  const args = { kind: "create_issue", projectId, columnId: project.columns[0].id, title, assignedToEmail: alex.user.email, dueDate: "2026-10-01", priority: "medium" };
  const tool = { op: "tool", jobId: job.jobId, callId: "create-1", name: "origin_change", args };
  assert.equal((await post(tool, device.token)).status, "pending");
  let board = await query("tasks:board", { sessionToken: alex.sessionToken, projectId });
  assert.ok(!board.tasks.some(t => t.title === title), "No write before approval");
  const approval = (await snapshot(job.threadId)).approvals[0];
  await post({ op: "decide", approvalId: approval.id, approved: true }, sam.sessionToken, 400);
  await post({ ...tool, args: { ...args, title: "Tampered" } }, device.token, 400);
  await post({ op: "decide", approvalId: approval.id, approved: true });
  const applied = await post(tool, device.token);
  assert.equal(applied.status, "applied");
  assert.equal((await post(tool, device.token)).result, applied.result);
  board = await query("tasks:board", { sessionToken: alex.sessionToken, projectId });
  assert.equal(board.tasks.filter(t => t.title === title).length, 1, "Retries must be idempotent");
  const taskId = JSON.parse(applied.result).id;
  const complete = { ...tool, callId: "complete-1", args: { kind: "update_issue", projectId, taskId, done: true } };
  await post(complete, device.token);
  const completion = (await snapshot(job.threadId)).approvals.find(p => p.status === "pending");
  await post({ op: "progress", jobId: job.jobId, status: "completed", response: "Proposed task completion" }, device.token);
  assert.ok((await snapshot(job.threadId)).approvals.some(p => p.id === completion.id && p.status === "pending"), "Proposal survives model completion");
  await post({ op: "decide", approvalId: completion.id, approved: true });
  await post({ op: "decide", approvalId: completion.id, approved: true });
  assert.equal((await snapshot(job.threadId)).approvals.find(p => p.id === completion.id).status, "applied");
  assert.equal((await snapshot(job.threadId)).jobs[0].status, "completed");
  console.log("PASS pairing, private conversations, scoped reads, persistent approvals, tamper rejection, idempotent issue creation and completion");

  const readonlyPair = await post({ op: "pair", write: false });
  const readonly = await post({ op: "pair-device", code: readonlyPair.code, name: "Read-only QA" }); connections.push(readonly);
  const readonlyJob = await post({ op: "send", deviceId: readonly.deviceId, prompt: "Read only", skill: "workspace" });
  await post({ op: "poll" }, readonly.token);
  await post({ ...tool, jobId: readonlyJob.jobId }, readonly.token, 400);
  await post({ op: "stop", jobId: readonlyJob.jobId });
  assert.equal((await post({ op: "progress", jobId: readonlyJob.jobId, status: "completed" }, readonly.token)).status, "cancelled");
  await post({ ...tool, jobId: readonlyJob.jobId }, readonly.token, 400);
  const grants = await query("connectors:listGrants", { sessionToken: alex.sessionToken, ...scope });
  const deviceGrant = (await snapshot()).devices.find(d => d.id === device.deviceId).grantId;
  assert.ok(grants.some(g => g._id === deviceGrant));
  await mutation("connectors:revoke", { sessionToken: alex.sessionToken, ...scope, grantId: deviceGrant });
  await post({ op: "poll" }, device.token, 400);
  console.log("PASS read-only grants, cancellation, no writes after stop and immediate connector revocation");
} finally {
  for (const device of connections) await post({ op: "disconnect", deviceId: device.deviceId }).catch(() => {});
}
