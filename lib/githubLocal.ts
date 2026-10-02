export type ParsedGitHubRepo = { owner: string; repo: string };

export function parseGitHubRepo(repoUrl?: string): ParsedGitHubRepo | null {
  if (!repoUrl) return null;
  const value = repoUrl.trim();
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/i, "") };
  const match = value.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

export function githubHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "origin-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function githubRepoUrl(repo: ParsedGitHubRepo) {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

export function manualIssueUrl(repo: ParsedGitHubRepo, title: string, body: string) {
  const params = new URLSearchParams();
  if (title.trim()) params.set("title", title.trim());
  if (body.trim()) params.set("body", body.trim());
  return `${githubRepoUrl(repo)}/issues/new?${params.toString()}`;
}
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DEFAULT_OWNER_EMAIL } from "@/convex/lib/auth";
import { getConvexClient, requireLocalUser } from "./localRealtime";
import { githubConnectionInfo, githubConnectionToken } from "./githubConnection";
import { workspaceGitHubToken } from "./github-workspace";
import { integrationBridge } from "./integration-bridge";

export async function githubProject(sessionToken: string, projectId: string | undefined, write = false) {
  if (!projectId) throw new Error("Project required");
  const user = await requireLocalUser(sessionToken);
  const project = await getConvexClient().query(api.projects.get, { sessionToken, projectId: projectId as Id<"projects"> });
  if (write && project.memberRole === "viewer") throw new Error("Edit role required");
  const repo = parseGitHubRepo(project.repoUrl);
  const repoName = repo ? `${repo.owner}/${repo.repo}`.toLowerCase() : null;
  const saved = repoName ? githubConnectionInfo(project._id, repoName) : null;
  const credential = saved ? await integrationBridge<{ credentialAllowed: boolean }>("context", { projectId, credentialOwner: saved.connectedBy }) : null;
  const token = repoName && credential?.credentialAllowed ? githubConnectionToken(project._id, repoName) : undefined;
  const legacyToken = user.email === DEFAULT_OWNER_EMAIL && project.ownerEmail === DEFAULT_OWNER_EMAIL ? process.env.GITHUB_TOKEN : undefined;
  const workspace = project.teamId ? await getConvexClient().query(api.integrations.status, { sessionToken, teamId: project.teamId }) : null;
  const workspaceToken = !token && project.githubWorkspaceAccess && workspace?.connectedBy && project.teamId ? await workspaceGitHubToken(project.teamId, workspace.connectedBy) : undefined;
  return { project, user, token: token || workspaceToken || legacyToken };
}
