import { api } from "@/convex/_generated/api";
import { agentChange, readAgentWorkspace } from "./agent-tools";
import { agentJobToken, agentDeviceToken, proposeAgentChange, runnerJob, type AgentDevice } from "./agent-store";
import { getAgentSettings } from "./agent-settings";
import { getConvexClient, limitLocalAction } from "./localRealtime";

export async function requireAgentWrite(device: AgentDevice, kind: string) {
  const transport = await getConvexClient().query(api.agentWorkspace.identity, { token: agentDeviceToken(device, device.id) });
  if (!transport.write && kind !== "request_vault") throw new Error("This agent connection is read-only");
}

export async function executeAgentTool(device: AgentDevice, jobId: string, callId: string, name: string, args: unknown) {
  const job = runnerJob(device, jobId);
  if (!getAgentSettings(device.teamId).enabled) throw new Error("Agent is disabled for this workspace");
  if (!["running", "waiting"].includes(job.status)) throw new Error("Request is no longer running");
  if (job.skill === "format") throw new Error("Issue formatting cannot access workspace tools");
  const token = agentJobToken(job, device);
  const auth = await getConvexClient().query(api.agentWorkspace.identity, { token });
  if (auth.teamId !== device.teamId) throw new Error("Wrong workspace");
  limitLocalAction(`agent-tools:${jobId}`, 300, 3600000);
  if (name === "origin_read") return { status: "applied", result: await readAgentWorkspace(token, args) };
  if (name !== "origin_change") throw new Error("Unknown Origin tool");
  const change = agentChange.parse(args);
  if (!auth.write && change.kind !== "request_vault") throw new Error("This agent connection is read-only");
  await requireAgentWrite(device, change.kind);
  const approval = proposeAgentChange(device, jobId, callId, change);
  return { status: approval.status, result: approval.result, approvalId: approval.id };
}
