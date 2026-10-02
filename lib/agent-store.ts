import { createHash, randomBytes, randomUUID } from "node:crypto";
import { integrationDb, openIntegration, sealIntegration } from "./githubConnection";

export type AgentOwner = { teamId: string; userId: string };
export type AgentDevice = AgentOwner & { id: string; tokenHash: string; grantId: string; name: string; seen: number; expires: number; revoked: number; sealed: string };
export type AgentJob = { id: string; threadId: string; deviceId: string; prompt: string; response: string; status: string; created: number; updated: number; error: string | null; runnerThread: string | null; projectId: string | null; skill: string; sealedScope: string | null; model: string | null; reasoning: string | null };
export type AgentApproval = { id: string; jobId: string; args: string; status: string; result: string | null };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
let ready = false;
function db() {
  const connection = integrationDb();
  if (!ready) {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS agent_pairings (code TEXT PRIMARY KEY, teamId TEXT NOT NULL, userId TEXT NOT NULL, grantId TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL, grantExpires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_devices (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, userId TEXT NOT NULL, tokenHash TEXT UNIQUE NOT NULL, grantId TEXT NOT NULL, name TEXT NOT NULL, seen INTEGER NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS agent_devices_owner ON agent_devices(teamId,userId);
      CREATE TABLE IF NOT EXISTS agent_threads (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, userId TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_threads_owner ON agent_threads(teamId,userId,updated);
      CREATE TABLE IF NOT EXISTS agent_jobs (id TEXT PRIMARY KEY, threadId TEXT NOT NULL, deviceId TEXT NOT NULL, prompt TEXT NOT NULL, response TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, error TEXT, runnerThread TEXT, projectId TEXT, skill TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_jobs_thread ON agent_jobs(threadId,created);
      CREATE INDEX IF NOT EXISTS agent_jobs_device_status ON agent_jobs(deviceId,status);
      CREATE TABLE IF NOT EXISTS agent_approvals (id TEXT PRIMARY KEY, jobId TEXT NOT NULL, args TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
      CREATE INDEX IF NOT EXISTS agent_approvals_job ON agent_approvals(jobId);
    `);
    if (!(connection.prepare("PRAGMA table_info(agent_devices)").all() as { name: string }[]).some(column => column.name === "sealed")) connection.exec("ALTER TABLE agent_devices ADD COLUMN sealed TEXT NOT NULL DEFAULT ''");
    const jobColumns = new Set((connection.prepare("PRAGMA table_info(agent_jobs)").all() as { name: string }[]).map(column => column.name));
    for (const name of ["sealedScope", "model", "reasoning"]) if (!jobColumns.has(name)) connection.exec(`ALTER TABLE agent_jobs ADD COLUMN ${name} TEXT`);
    ready = true;
  }
  return connection;
}
export function createPairing(owner: AgentOwner, token: string, grantId: string, grantExpires: number) {
  const code = randomBytes(24).toString("hex");
  const digest = hash(code);
  const expires = Date.now() + 10 * 60000;
  db().prepare("DELETE FROM agent_pairings WHERE expires < ?").run(Date.now());
  db().prepare("INSERT INTO agent_pairings VALUES(?,?,?,?,?,?,?)").run(digest, owner.teamId, owner.userId, grantId, sealIntegration(token, `agent:${digest}`), expires, grantExpires);
  return { code, expires };
}
export function consumePairing(code: string, name: string) {
  const digest = hash(code);
  const row = db().prepare("DELETE FROM agent_pairings WHERE code=? AND expires>? RETURNING *").get(digest, Date.now()) as (AgentOwner & { sealed: string; grantId: string; grantExpires: number }) | undefined;
  if (!row) throw new Error("Pairing code expired or already used");
  const token = openIntegration(row.sealed, `agent:${digest}`);
  const id = randomUUID();
  db().prepare("INSERT INTO agent_devices(id,teamId,userId,tokenHash,grantId,name,seen,expires,sealed) VALUES(?,?,?,?,?,?,?,?,?)").run(id, row.teamId, row.userId, hash(token), row.grantId, name.slice(0, 80), Date.now(), row.grantExpires, sealIntegration(token, `agent-device:${id}`));
  return { token, deviceId: id };
}
export function deviceForToken(token: string) {
  const device = db().prepare("SELECT * FROM agent_devices WHERE tokenHash=? AND revoked=0 AND expires>?").get(hash(token), Date.now()) as AgentDevice | undefined;
  if (!device) throw new Error("Agent connection expired or revoked");
  return device;
}
export function getDevice(owner: AgentOwner, id: string, shared = false) {
  const device = db().prepare("SELECT * FROM agent_devices WHERE id=? AND teamId=? AND (?=1 OR userId=?) AND revoked=0").get(id, owner.teamId, shared ? 1 : 0, owner.userId) as AgentDevice | undefined;
  if (!device || device.expires <= Date.now()) throw new Error("Agent connection unavailable");
  return device;
}
export function agentDeviceToken(owner: AgentOwner, id: string) {
  const device = getDevice(owner, id);
  if (!device.sealed) throw new Error("Reconnect this computer before approving changes");
  return openIntegration(device.sealed, `agent-device:${device.id}`);
}
function ownedThread(owner: AgentOwner, threadId: string) {
  const thread = db().prepare("SELECT * FROM agent_threads WHERE id=? AND teamId=? AND userId=?").get(threadId, owner.teamId, owner.userId);
  if (!thread) throw new Error("Conversation not found");
  return thread;
}
export function agentSnapshot(owner: AgentOwner, threadId?: string, sharedDeviceId?: string | null) {
  const now = Date.now();
  db().prepare("UPDATE agent_jobs SET status='failed',error='The agent disconnected. Send another message to retry.' WHERE ((status IN ('running','waiting') AND updated<?) OR (status='queued' AND updated<? AND deviceId IN (SELECT id FROM agent_devices WHERE seen<?))) AND threadId IN (SELECT id FROM agent_threads WHERE teamId=? AND userId=?)").run(now - 90000, now - 90000, now - 90000, owner.teamId, owner.userId);
  const devices = db().prepare("SELECT id,name,seen,expires,grantId,userId FROM agent_devices WHERE teamId=? AND (userId=? OR id=?) AND revoked=0 AND expires>? ORDER BY seen DESC LIMIT 20").all(owner.teamId, owner.userId, sharedDeviceId || "", now);
  const threads = db().prepare("SELECT id,title,updated FROM agent_threads WHERE teamId=? AND userId=? AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.threadId=agent_threads.id AND j.skill='format') ORDER BY updated DESC LIMIT 100").all(owner.teamId, owner.userId);
  if (!threadId) return { devices, threads, jobs: [], approvals: [] };
  ownedThread(owner, threadId);
  const jobs = db().prepare("SELECT * FROM (SELECT * FROM agent_jobs WHERE threadId=? ORDER BY created DESC LIMIT 100) ORDER BY created").all(threadId) as AgentJob[];
  const approvals = db().prepare("SELECT a.* FROM agent_approvals a JOIN agent_jobs j ON j.id=a.jobId WHERE j.threadId=? ORDER BY a.rowid DESC LIMIT 100").all(threadId).reverse();
  return { devices, threads, jobs: jobs.map(({ sealedScope: _sealed, ...job }) => job), approvals };
}
export function enqueueAgent(owner: AgentOwner, args: { threadId?: string; deviceId: string; prompt: string; projectId?: string; skill: string; shared?: boolean; scopeToken?: string; model?: string; reasoning?: string }) {
  const device = getDevice(owner, args.deviceId, args.shared);
  if (device.seen < Date.now() - 30000) throw new Error("Connect your computer before sending a message");
  const threadId = args.threadId || randomUUID();
  if (args.threadId) ownedThread(owner, threadId);
  const now = Date.now();
  db().exec("BEGIN IMMEDIATE");
  try {
    if (db().prepare("SELECT j.id FROM agent_jobs j JOIN agent_threads t ON t.id=j.threadId WHERE j.deviceId=? AND t.userId=? AND j.status IN ('queued','running','waiting')").get(device.id, owner.userId)) throw new Error("Finish or stop your current Agent request first.");
    const queued = db().prepare("SELECT count(*) AS n FROM agent_jobs WHERE deviceId=? AND status IN ('queued','running','waiting')").get(device.id) as { n: number };
    if (queued.n >= 20) throw new Error("The workspace agent queue is full. Try again shortly.");
    if (!args.threadId) db().prepare("INSERT INTO agent_threads VALUES(?,?,?,?,?,?)").run(threadId, owner.teamId, owner.userId, args.prompt.slice(0, 80), now, now);
    const id = randomUUID();
    db().prepare("INSERT INTO agent_jobs(id,threadId,deviceId,prompt,status,created,updated,projectId,skill,sealedScope,model,reasoning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(id, threadId, device.id, args.prompt, "queued", now, now, args.projectId || null, args.skill, args.scopeToken ? sealIntegration(args.scopeToken, `agent-job:${id}`) : null, args.model || "gpt-6-luna", args.reasoning || "default");
    db().prepare("UPDATE agent_threads SET updated=? WHERE id=?").run(now, threadId);
    db().exec("COMMIT");
    return { threadId, jobId: id };
  } catch (error) { db().exec("ROLLBACK"); throw error; }
}
export function claimAgentJob(device: AgentDevice) {
  db().prepare("UPDATE agent_devices SET seen=? WHERE id=?").run(Date.now(), device.id);
  db().prepare("UPDATE agent_jobs SET status='failed',error='Agent interrupted. Send another message to retry.' WHERE deviceId=? AND status IN ('running','waiting') AND updated<?").run(device.id, Date.now() - 90000);
  if (db().prepare("SELECT id FROM agent_jobs WHERE deviceId=? AND status IN ('running','waiting')").get(device.id)) return null;
  const job = db().prepare("UPDATE agent_jobs SET status='running',updated=? WHERE id=(SELECT id FROM agent_jobs WHERE deviceId=? AND status='queued' ORDER BY created LIMIT 1) RETURNING *").get(Date.now(), device.id) as AgentJob | undefined;
  if (!job) return null;
  const previous = db().prepare("SELECT runnerThread FROM agent_jobs WHERE threadId=? AND deviceId=? AND id<>? AND skill=? AND runnerThread IS NOT NULL ORDER BY created DESC LIMIT 1").get(job.threadId, device.id, job.id, job.skill) as { runnerThread: string } | undefined;
  const { sealedScope: _sealed, ...safe } = job;
  return { ...safe, runnerThread: previous?.runnerThread || null };
}
export function agentJobToken(job: AgentJob, device: AgentDevice) {
  return job.sealedScope ? openIntegration(job.sealedScope, `agent-job:${job.id}`) : openIntegration(device.sealed, `agent-device:${device.id}`);
}
export function ensureApiDevice(owner: AgentOwner, token: string, grantId: string, expires: number) {
  const id = `api:${owner.teamId}:${owner.userId}`;
  db().prepare("INSERT INTO agent_devices(id,teamId,userId,tokenHash,grantId,name,seen,expires,sealed) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tokenHash=excluded.tokenHash,grantId=excluded.grantId,seen=excluded.seen,expires=excluded.expires,sealed=excluded.sealed,revoked=0").run(id, owner.teamId, owner.userId, hash(token), grantId, "Workspace API", Date.now(), expires, sealIntegration(token, `agent-device:${id}`));
  return getDevice(owner, id);
}
export function cancelWorkspaceJobs(teamId: string) {
  db().prepare("UPDATE agent_jobs SET status='cancelled',updated=? WHERE status IN ('queued','running','waiting') AND threadId IN (SELECT id FROM agent_threads WHERE teamId=?)").run(Date.now(), teamId);
  db().prepare("UPDATE agent_approvals SET status='declined' WHERE status='pending' AND jobId IN (SELECT j.id FROM agent_jobs j JOIN agent_threads t ON t.id=j.threadId WHERE t.teamId=?)").run(teamId);
}
export function approvedAgentContext(owner: AgentOwner, approval: AgentApproval & { deviceId: string }) {
  const device = getDevice(owner, approval.deviceId, true);
  const job = runnerJob(device, approval.jobId);
  ownedThread(owner, job.threadId);
  return { device, job, token: agentJobToken(job, device) };
}
export function runnerJob(device: AgentDevice, jobId: string) {
  const job = db().prepare("SELECT * FROM agent_jobs WHERE id=? AND deviceId=?").get(jobId, device.id) as AgentJob | undefined;
  if (!job) throw new Error("Request not found");
  return job;
}
export function updateAgentJob(device: AgentDevice, jobId: string, args: { response?: string; runnerThread?: string; status?: "completed" | "failed"; error?: string }) {
  const job = runnerJob(device, jobId);
  db().prepare("UPDATE agent_devices SET seen=? WHERE id=?").run(Date.now(), device.id);
  if (!["running", "waiting"].includes(job.status)) return { status: job.status };
  db().prepare("UPDATE agent_jobs SET response=?,runnerThread=?,status=?,error=?,updated=? WHERE id=?").run(args.response ?? job.response, args.runnerThread ?? job.runnerThread, args.status ?? job.status, args.error ?? job.error, Date.now(), jobId);
  return { status: args.status ?? job.status };
}
export function stopAgentJob(owner: AgentOwner, jobId: string) {
  const job = db().prepare("SELECT * FROM agent_jobs WHERE id=?").get(jobId) as AgentJob | undefined;
  if (!job) throw new Error("Request not found");
  ownedThread(owner, job.threadId);
  db().prepare("UPDATE agent_jobs SET status='cancelled',updated=? WHERE id=? AND status IN ('queued','running','waiting')").run(Date.now(), jobId);
}
export function proposeAgentChange(device: AgentDevice, jobId: string, callId: string, args: unknown) {
  const job = runnerJob(device, jobId);
  if (!["running", "waiting"].includes(job.status)) throw new Error("Request is no longer running");
  const id = hash(`${jobId}:${callId}`);
  const value = JSON.stringify(args);
  db().prepare("INSERT OR IGNORE INTO agent_approvals VALUES(?,?,?,'pending',NULL)").run(id, jobId, value);
  const approval = db().prepare("SELECT * FROM agent_approvals WHERE id=?").get(id) as AgentApproval;
  if (approval.args !== value) throw new Error("Tool call changed after submission");
  return approval;
}
export function decideAgentChange(owner: AgentOwner, id: string, approved: boolean) {
  const row = db().prepare("SELECT j.threadId,j.status,j.deviceId FROM agent_approvals a JOIN agent_jobs j ON j.id=a.jobId WHERE a.id=?").get(id) as { threadId: string; status: string; deviceId: string } | undefined;
  if (!row) throw new Error("Proposal not found");
  ownedThread(owner, row.threadId);
  if (!["running", "waiting", "completed"].includes(row.status)) throw new Error("Request is no longer available");
  db().prepare("UPDATE agent_approvals SET status=? WHERE id=? AND status='pending'").run(approved ? "approved" : "declined", id);
  return { ...db().prepare("SELECT * FROM agent_approvals WHERE id=?").get(id) as AgentApproval, deviceId: row.deviceId };
}
export function retryAgentApproval(id: string) {
  db().prepare("UPDATE agent_approvals SET status='pending' WHERE id=? AND status='approved'").run(id);
}
export function saveAgentToolResult(id: string, result: string) {
  db().prepare("UPDATE agent_approvals SET status='applied',result=? WHERE id=? AND status='approved'").run(result, id);
  db().prepare("UPDATE agent_jobs SET status='running' WHERE id=(SELECT jobId FROM agent_approvals WHERE id=?) AND status='waiting'").run(id);
}
export function revokeAgentDevice(owner: AgentOwner, id: string) {
  getDevice(owner, id);
  db().prepare("UPDATE agent_devices SET revoked=1 WHERE id=?").run(id);
  db().prepare("UPDATE agent_jobs SET status='cancelled' WHERE deviceId=? AND status IN ('queued','running','waiting')").run(id);
  db().prepare("UPDATE agent_approvals SET status='declined' WHERE status='pending' AND jobId IN (SELECT id FROM agent_jobs WHERE deviceId=?)").run(id);
}
