// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("./localRealtime", () => ({ localDataDir: () => process.env.ORIGIN_AGENT_TEST_DIR! }));
const directory = mkdtempSync(path.join(tmpdir(), "origin-agent-test-"));
process.env.ORIGIN_AGENT_TEST_DIR = directory;
const store = await import("./agent-store");
const { integrationDb } = await import("./githubConnection");
const settingsStore = await import("./agent-settings");
const owner = { teamId: "team-a", userId: "user-a" };
const other = { teamId: "team-a", userId: "user-b" };
let n = 0;
function device() {
  const token = `test-token-${++n}`;
  const pair = store.createPairing(owner, token, `grant-${n}`, Date.now() + 86400000);
  const connected = store.consumePairing(pair.code, "Test computer");
  return { pair, ...connected, device: store.deviceForToken(token) };
}
afterAll(() => { integrationDb().close(); rmSync(directory, { recursive: true, force: true }); delete process.env.ORIGIN_AGENT_TEST_DIR; });

describe("Agent isolation and approvals", () => {
  it("encrypts BYOK credentials and never carries them to another provider", () => {
    const settings = { ...settingsStore.getAgentSettings(owner.teamId), mode: "api", model: "test-model" };
    const saved = settingsStore.saveAgentSettings(owner.teamId, settings, "synthetic-api-key");
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("synthetic-api-key");
    expect(JSON.stringify(integrationDb().prepare("SELECT * FROM agent_settings").all())).not.toContain("synthetic-api-key");
    expect(settingsStore.agentApiKey(owner.teamId, "openai")).toBe("synthetic-api-key");
    expect(() => settingsStore.agentApiKey(owner.teamId, "anthropic")).toThrow();
    expect(() => settingsStore.saveAgentSettings(owner.teamId, { ...settings, provider: "anthropic" })).toThrow(/API key/);
    expect(settingsStore.saveAgentSettings(owner.teamId, { ...settings, enabled: false }, "").hasApiKey).toBe(false);
  });
  it("shares compute without sharing conversations or scoped credentials", () => {
    const d = device();
    const job = store.enqueueAgent(other, { deviceId: d.deviceId, prompt: "My work", skill: "workspace-v2", shared: true, scopeToken: "member-private-scope" });
    expect(() => store.agentSnapshot(owner, job.threadId)).toThrow();
    expect(JSON.stringify(store.agentSnapshot(other, job.threadId, d.deviceId))).not.toContain("member-private-scope");
    const claimed = store.claimAgentJob(d.device)!;
    expect(claimed).not.toHaveProperty("sealedScope");
    expect(store.agentJobToken(store.runnerJob(d.device, job.jobId), d.device)).toBe("member-private-scope");
    const next = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Queued", skill: "workspace-v2" });
    expect(store.claimAgentJob(d.device)).toBeNull();
    integrationDb().prepare("UPDATE agent_jobs SET updated=? WHERE id=?").run(Date.now() - 91000, next.jobId);
    expect(store.agentSnapshot(owner, next.threadId).jobs[0].status).toBe("queued");
    const proposal = store.proposeAgentChange(d.device, job.jobId, "shared-proposal", { kind: "create_project", name: "Example" });
    expect(() => store.decideAgentChange(owner, proposal.id, true)).toThrow();
    const approved = store.decideAgentChange(other, proposal.id, true);
    expect(store.approvedAgentContext(other, approved).token).toBe("member-private-scope");
    store.cancelWorkspaceJobs(owner.teamId);
    expect(store.runnerJob(d.device, job.jobId).status).toBe("cancelled");
  });
  it("encrypts pairing credentials, consumes them once and never returns tokens in snapshots", () => {
    const token = "sensitive-test-connector-token";
    const pair = store.createPairing(owner, token, "grant-secret", Date.now() + 86400000);
    expect(JSON.stringify(integrationDb().prepare("SELECT * FROM agent_pairings").all())).not.toContain(token);
    expect(readFileSync(path.join(directory, "integrations.key")).length).toBe(32);
    expect(store.consumePairing(pair.code, "Computer").token).toBe(token);
    expect(() => store.consumePairing(pair.code, "Again")).toThrow(/expired|used/);
    expect(JSON.stringify(store.agentSnapshot(owner))).not.toContain(token);
    expect(store.agentSnapshot(other).devices).toHaveLength(0);
  });
  it("binds jobs to the user, workspace and computer, and allows only one active job per computer", () => {
    const d = device();
    expect(() => store.enqueueAgent(other, { deviceId: d.deviceId, prompt: "No", skill: "workspace" })).toThrow();
    const job = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Review", skill: "workspace" });
    expect(() => store.agentSnapshot(other, job.threadId)).toThrow();
    expect(() => store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Again", skill: "workspace" })).toThrow(/current Agent request/);
    expect(store.claimAgentJob(d.device)?.id).toBe(job.jobId);
    expect(store.claimAgentJob(d.device)).toBeNull();
    expect(() => store.runnerJob(device().device, job.jobId)).toThrow();
    expect(() => store.stopAgentJob(other, job.jobId)).toThrow();
    store.stopAgentJob(owner, job.jobId);
    expect(store.updateAgentJob(d.device, job.jobId, { status: "completed" }).status).toBe("cancelled");
  });
  it("approves exact arguments once, persists results for retries and prevents cross-user consent", () => {
    const d = device();
    const job = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Create", skill: "workspace" });
    store.claimAgentJob(d.device);
    const args = { kind: "create_project", name: "Example" };
    const approval = store.proposeAgentChange(d.device, job.jobId, "call-1", args);
    expect(approval.status).toBe("pending");
    expect(() => store.proposeAgentChange(d.device, job.jobId, "call-1", { ...args, name: "Changed" })).toThrow(/changed/);
    expect(() => store.decideAgentChange(other, approval.id, true)).toThrow();
    store.decideAgentChange(owner, approval.id, true);
    expect(store.proposeAgentChange(d.device, job.jobId, "call-1", args).status).toBe("approved");
    store.saveAgentToolResult(approval.id, '{"id":"created"}');
    store.decideAgentChange(owner, approval.id, false);
    expect(store.proposeAgentChange(d.device, job.jobId, "call-1", args)).toMatchObject({ status: "applied", result: '{"id":"created"}' });
    store.updateAgentJob(d.device, job.jobId, { status: "completed", runnerThread: "local-thread", response: "Done" });
    const next = store.enqueueAgent(owner, { deviceId: d.deviceId, threadId: job.threadId, prompt: "Continue", skill: "workspace" });
    expect(store.claimAgentJob(d.device)).toMatchObject({ id: next.jobId, runnerThread: "local-thread" });
    store.stopAgentJob(owner, next.jobId);
    expect(() => store.proposeAgentChange(d.device, next.jobId, "late", args)).toThrow(/no longer/);
  });
  it("revokes a device immediately and expires abandoned queued requests", () => {
    const d = device();
    const job = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Wait", skill: "workspace" });
    integrationDb().prepare("UPDATE agent_jobs SET updated=? WHERE id=?").run(Date.now() - 91000, job.jobId);
    integrationDb().prepare("UPDATE agent_devices SET seen=? WHERE id=?").run(Date.now() - 91000, d.deviceId);
    expect(store.agentSnapshot(owner, job.threadId).jobs[0].status).toBe("failed");
    store.claimAgentJob(d.device);
    const next = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Another", skill: "workspace" });
    store.revokeAgentDevice(owner, d.deviceId);
    expect(() => store.deviceForToken(d.token)).toThrow(/revoked/);
    expect(store.runnerJob(d.device, next.jobId).status).toBe("cancelled");
  });
  it("keeps proposals after the model finishes and applies through the original user's encrypted grant", () => {
    const d = device();
    const job = store.enqueueAgent(owner, { deviceId: d.deviceId, prompt: "Propose", skill: "workspace" });
    store.claimAgentJob(d.device);
    const proposal = store.proposeAgentChange(d.device, job.jobId, "proposal", { kind: "create_project", name: "Example" });
    store.updateAgentJob(d.device, job.jobId, { status: "completed" });
    expect(store.agentSnapshot(owner, job.threadId).approvals).toHaveLength(1);
    expect(store.decideAgentChange(owner, proposal.id, true).status).toBe("approved");
    expect(store.agentDeviceToken(owner, d.deviceId)).toBe(d.token);
    expect(() => store.agentDeviceToken(other, d.deviceId)).toThrow();
    store.retryAgentApproval(proposal.id);
    expect(store.decideAgentChange(owner, proposal.id, true).status).toBe("approved");
    store.saveAgentToolResult(proposal.id, "done");
    expect(store.agentSnapshot(owner, job.threadId).approvals[0]).toMatchObject({ status: "applied" });
    expect(store.runnerJob(d.device, job.jobId).status).toBe("completed");
  });
});
