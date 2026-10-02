import { z } from "zod";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { integrationDb, openIntegration, sealIntegration } from "./githubConnection";
import { getConvexClient, type LocalWorkspaceUser } from "./localRealtime";

export const agentSettingsSchema = z.object({
  enabled: z.boolean(), mode: z.enum(["companion", "api"]),
  location: z.enum(["local", "server"]), provider: z.enum(["openai", "anthropic", "openrouter"]),
  model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:/-]+$/),
  reasoning: z.enum(["default", "none", "low", "medium", "high", "xhigh", "max"]),
  sharedDeviceId: z.string().max(100).nullable(),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;
const defaults: AgentSettings = { enabled: true, mode: "companion", location: "local", provider: "openai", model: "gpt-6-luna", reasoning: "default", sharedDeviceId: null };
function db() {
  const connection = integrationDb();
  connection.exec(`CREATE TABLE IF NOT EXISTS agent_settings(teamId TEXT PRIMARY KEY, settings TEXT NOT NULL, sealedKey TEXT);
    CREATE TABLE IF NOT EXISTS agent_user_scopes(teamId TEXT NOT NULL,userId TEXT NOT NULL,sealed TEXT NOT NULL,grantId TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(teamId,userId));`);
  return connection;
}
export function getAgentSettings(teamId: string) {
  const row = db().prepare("SELECT settings,sealedKey FROM agent_settings WHERE teamId=?").get(teamId) as { settings: string; sealedKey: string | null } | undefined;
  return { ...(row ? agentSettingsSchema.parse(JSON.parse(row.settings)) : defaults), hasApiKey: !!row?.sealedKey };
}
export function saveAgentSettings(teamId: string, input: unknown, apiKey?: string) {
  const settings = agentSettingsSchema.parse(input);
  const old = db().prepare("SELECT settings,sealedKey FROM agent_settings WHERE teamId=?").get(teamId) as { settings: string; sealedKey: string | null } | undefined;
  const sameProvider = old && JSON.parse(old.settings).provider === settings.provider;
  const sealedKey = apiKey === "" ? null : apiKey ? sealIntegration(apiKey, `agent-api:${teamId}:${settings.provider}`) : sameProvider ? old.sealedKey : null;
  if (settings.mode === "api" && settings.enabled && !sealedKey) throw new Error("Add your own provider API key before enabling API mode");
  if (settings.mode === "companion" && (!/^gpt-[a-zA-Z0-9.-]+$/.test(settings.model) || settings.provider !== "openai")) throw new Error("The subscription companion uses OpenAI Codex models");
  db().prepare("INSERT INTO agent_settings VALUES(?,?,?) ON CONFLICT(teamId) DO UPDATE SET settings=excluded.settings,sealedKey=excluded.sealedKey").run(teamId, JSON.stringify(settings), sealedKey);
  return getAgentSettings(teamId);
}
export function agentApiKey(teamId: string, provider: string) {
  const row = db().prepare("SELECT sealedKey FROM agent_settings WHERE teamId=?").get(teamId) as { sealedKey: string | null } | undefined;
  if (!row?.sealedKey) throw new Error("The workspace admin needs to add an API key");
  return openIntegration(row.sealedKey, `agent-api:${teamId}:${provider}`);
}

// A shared runner supplies compute, never its owner's Origin data permissions.
export async function userAgentScope(user: LocalWorkspaceUser, sessionToken: string) {
  const row = db().prepare("SELECT * FROM agent_user_scopes WHERE teamId=? AND userId=?").get(user.teamId, user._id) as { sealed: string; expires: number; grantId: string } | undefined;
  if (row && row.expires > Date.now()) {
    const token = openIntegration(row.sealed, `agent-scope:${user.teamId}:${user._id}`);
    try { await getConvexClient().query(api.agentWorkspace.identity, { token }); return token; } catch { /* Reauthorize a revoked or expired personal grant. */ }
  }
  const grant = await getConvexClient().mutation(api.connectors.createGrant, { sessionToken, teamId: user.teamId, name: "Origin Agent workspace access", write: user.workspaceRole !== "viewer", agentAccess: true });
  db().prepare("INSERT INTO agent_user_scopes VALUES(?,?,?,?,?) ON CONFLICT(teamId,userId) DO UPDATE SET sealed=excluded.sealed,grantId=excluded.grantId,expires=excluded.expires").run(user.teamId, user._id, sealIntegration(grant.token, `agent-scope:${user.teamId}:${user._id}`), grant.grantId as Id<"connectorGrants">, grant.expiresAt);
  return grant.token;
}
