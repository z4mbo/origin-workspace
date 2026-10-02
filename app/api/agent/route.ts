import { z } from "zod";
import { after } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient, limitLocalAction, requireLocalWorkspace, sessionTokenFromRequest } from "@/lib/localRealtime";
import { agentTools, applyAgentChange } from "@/lib/agent-tools";
import { agentSnapshot, approvedAgentContext, cancelWorkspaceJobs, claimAgentJob, consumePairing, createPairing, decideAgentChange, deviceForToken, enqueueAgent, ensureApiDevice, getDevice, retryAgentApproval, revokeAgentDevice, saveAgentToolResult, stopAgentJob, updateAgentJob } from "@/lib/agent-store";
import { agentSettingsSchema, getAgentSettings, saveAgentSettings, userAgentScope } from "@/lib/agent-settings";
import { executeAgentTool, requireAgentWrite } from "@/lib/agent-execution";
import { runApiAgent } from "@/lib/agent-api-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const id = z.string().min(1).max(100);
const browserRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("pair"), write: z.boolean(), extended: z.boolean().optional() }),
  z.object({ op: z.literal("send"), deviceId: id.optional(), threadId: id.optional(), prompt: z.string().trim().min(1).max(40000), projectId: id.optional(), skill: z.enum(["workspace", "plan", "triage"]).optional(), consent: z.boolean().optional() }),
  z.object({ op: z.literal("format"), projectId: id, text: z.string().trim().min(1).max(30000), consent: z.literal(true) }),
  z.object({ op: z.literal("settings"), settings: agentSettingsSchema, apiKey: z.string().max(2000).optional() }),
  z.object({ op: z.literal("enable-access"), deviceId: id }),
  z.object({ op: z.literal("stop"), jobId: id }),
  z.object({ op: z.literal("decide"), approvalId: id, approved: z.boolean() }),
  z.object({ op: z.literal("disconnect"), deviceId: id }),
]);
const runnerRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("poll") }),
  z.object({ op: z.literal("progress"), jobId: id, response: z.string().max(180000).optional(), runnerThread: id.optional(), status: z.enum(["completed", "failed"]).optional(), error: z.string().max(2000).optional() }),
  z.object({ op: z.literal("tool"), jobId: id, callId: id, name: z.enum(["origin_read", "origin_change"]), args: z.unknown() }),
]);
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required");
  let size = 0; const chunks = [];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 800000) { await reader.cancel(); throw new Error("Request too large"); } chunks.push(chunk.value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function GET(request: Request) {
  try {
    const user = await requireLocalWorkspace(request);
    const threadId = new URL(request.url).searchParams.get("threadId") || undefined;
    const settings = getAgentSettings(user.teamId);
    return json({ ...agentSnapshot({ userId: user._id, teamId: user.teamId }, threadId, settings.sharedDeviceId), settings, canConfigure: ["owner", "admin"].includes(user.workspaceRole), userId: user._id });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not load Agent" }, 400); }
}
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    if (body.op === "pair-device") {
      limitLocalAction(`agent-pair:${request.headers.get("x-real-ip") || "unknown"}`, 20, 60000);
      const { code, name } = z.object({ code: z.string().regex(/^[a-f0-9]{48}$/), name: z.string().min(1).max(80) }).parse(body);
      return json(consumePairing(code, name));
    }
    if (["poll", "progress", "tool"].includes(body.op)) {
      const value = runnerRequest.parse(body);
      const token = sessionTokenFromRequest(request);
      const device = deviceForToken(token);
      const auth = await getConvexClient().query(api.connectors.verify, { token });
      if (auth.teamId !== device.teamId) throw new Error("Wrong workspace");
      if (value.op === "poll") return json({ job: claimAgentJob(device), tools: agentTools });
      if (value.op === "progress") return json(updateAgentJob(device, value.jobId, value));
      return json(await executeAgentTool(device, value.jobId, value.callId, value.name, value.args));
    }
    const value = browserRequest.parse(body);
    const user = await requireLocalWorkspace(request, body);
    const sessionToken = sessionTokenFromRequest(request, body);
    const owner = { userId: user._id, teamId: user.teamId };
    const settings = getAgentSettings(user.teamId);
    if (value.op === "settings") {
      if (!["owner", "admin"].includes(user.workspaceRole)) throw new Error("Workspace admin access required");
      if (value.settings.sharedDeviceId && value.settings.sharedDeviceId !== settings.sharedDeviceId) getDevice(owner, value.settings.sharedDeviceId);
      const next = saveAgentSettings(user.teamId, value.settings, value.apiKey);
      if (!next.enabled || next.mode !== settings.mode || next.provider !== settings.provider || next.sharedDeviceId !== settings.sharedDeviceId || value.apiKey !== undefined) cancelWorkspaceJobs(user.teamId);
      return json({ settings: next });
    }
    if (value.op === "enable-access") {
      const device = getDevice(owner, value.deviceId);
      await getConvexClient().mutation(api.agentWorkspace.enable, { sessionToken, teamId: user.teamId, grantId: device.grantId as Id<"connectorGrants"> });
      return json({ ok: true });
    }
    if (value.op === "pair") {
      if (!settings.enabled) throw new Error("Agent is disabled for this workspace");
      limitLocalAction(`agent-pair-create:${user._id}`, 6, 3600000);
      const grant = await getConvexClient().mutation(api.connectors.createGrant, { sessionToken, teamId: user.teamId, name: "Origin Agent", write: value.write, agentAccess: value.extended });
      return json(createPairing(owner, grant.token, grant.grantId, grant.expiresAt));
    }
    if (value.op === "send" || value.op === "format") {
      if (!settings.enabled) throw new Error("Agent is disabled for this workspace");
      limitLocalAction(`agent-send:${user._id}`, 30, 60000);
      if (value.projectId) {
        const project = await getConvexClient().query(api.projects.get, { sessionToken, projectId: value.projectId as Id<"projects"> });
        if (project.teamId !== user.teamId) throw new Error("Project is not in this workspace");
      }
      let scopeToken: string | undefined;
      let selectedDevice = value.op === "send" ? value.deviceId : undefined;
      const shared = settings.mode === "companion" && !!settings.sharedDeviceId;
      if (shared || settings.mode === "api" || value.consent) {
        if (!value.consent) throw new Error("Confirm that prompts and requested workspace data may be sent to the configured AI provider");
        scopeToken = await userAgentScope(user, sessionToken);
      }
      if (shared) selectedDevice = settings.sharedDeviceId!;
      if (settings.mode === "api") {
        const identity = await getConvexClient().query(api.agentWorkspace.identity, { token: scopeToken! });
        selectedDevice = ensureApiDevice(owner, scopeToken!, identity.grantId, identity.expiresAt).id;
      }
      if (!selectedDevice) selectedDevice = (agentSnapshot(owner).devices as { id: string }[]).find(device => !device.id.startsWith("api:"))?.id;
      if (!selectedDevice) throw new Error("Connect a companion or configure a workspace API provider in Agent");
      const device = getDevice(owner, selectedDevice, shared);
      const prompt = value.op === "format" ? `<issue-description>\n${value.text}\n</issue-description>` : value.prompt;
      const result = enqueueAgent(owner, { deviceId: device.id, threadId: value.op === "send" ? value.threadId : undefined, projectId: value.projectId, prompt, skill: value.op === "format" ? "format" : "workspace-v2", shared, scopeToken, model: settings.model, reasoning: settings.reasoning });
      if (settings.mode === "api") after(() => runApiAgent(device));
      return json(result);
    }
    if (value.op === "stop") stopAgentJob(owner, value.jobId);
    if (value.op === "decide") {
      if (!settings.enabled) throw new Error("Agent is disabled for this workspace");
      const approval = decideAgentChange(owner, value.approvalId, value.approved);
      if (value.approved && approval.status === "approved") {
        try {
          const { token, device } = approvedAgentContext(owner, approval);
          const change = JSON.parse(approval.args);
          await requireAgentWrite(device, change.kind);
          const result = await applyAgentChange(token, `agent-${approval.id}`, change, sessionToken, user);
          saveAgentToolResult(approval.id, result);
        } catch (error) { retryAgentApproval(approval.id); throw error; }
      }
    }
    if (value.op === "disconnect") {
      const device = getDevice(owner, value.deviceId);
      await getConvexClient().mutation(api.connectors.revoke, { sessionToken, teamId: user.teamId, grantId: device.grantId as Id<"connectorGrants"> });
      revokeAgentDevice(owner, device.id);
    }
    return json({ ok: true });
  } catch (error) { return json({ error: error instanceof z.ZodError ? "Invalid Agent request" : error instanceof Error ? error.message : "Agent request failed" }, 400); }
}
