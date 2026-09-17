import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail, requireUser } from "./auth";

type Ctx = QueryCtx | MutationCtx;
type RoleCarrier = { role: "owner" | "admin" | "member" | "viewer" };

export { normalizeEmail };

export async function getActiveMember(ctx: Ctx, projectId: Id<"projects">, email: string) {
  const member = await ctx.db
    .query("members")
    .withIndex("by_project_email", (q) =>
      q.eq("projectId", projectId).eq("email", normalizeEmail(email)),
    )
    .unique();
  return member?.status === "active" ? member : null;
}

export async function getActiveTeamMember(ctx: Ctx, teamId: Id<"teams">, email: string) {
  const member = await ctx.db
    .query("teamMembers")
    .withIndex("by_team_email", (q) => q.eq("teamId", teamId).eq("email", normalizeEmail(email)))
    .unique();
  return member?.status === "active" ? member : null;
}

export async function requireTeamMember(ctx: Ctx, teamId: Id<"teams">, sessionToken: string) {
  const user = await requireUser(ctx, sessionToken);
  const member = await getActiveTeamMember(ctx, teamId, user.email);
  if (!member || (member.userId && member.userId !== user._id)) throw new Error("No active team access");
  return { member, user };
}

export async function requireTeamAdmin(ctx: Ctx, teamId: Id<"teams">, sessionToken: string) {
  const { member, user } = await requireTeamMember(ctx, teamId, sessionToken);
  if (member.role !== "owner" && member.role !== "admin") throw new Error("Admin role required");
  return { member, user };
}

export async function requireMember(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const user = await requireUser(ctx, sessionToken);
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");

  if (project.teamId) {
    const teamMember = await getActiveTeamMember(ctx, project.teamId, user.email);
    if (teamMember && (!teamMember.userId || teamMember.userId === user._id)) return { member: teamMember, user, project };
    throw new Error("No active workspace access");
  }

  const member = await getActiveMember(ctx, projectId, user.email);
  if (member && (!member.userId || member.userId === user._id)) return { member, user, project };

  throw new Error("No active project access");
}

export async function requireAdmin(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const { member, user, project } = await requireMember(ctx, projectId, sessionToken);
  if (member.role !== "owner" && member.role !== "admin") {
    throw new Error("Admin role required");
  }
  return { member, user, project };
}

export async function touchProject(ctx: MutationCtx, projectId: Id<"projects">) {
  await ctx.db.patch(projectId, { updatedAt: Date.now() });
}

export async function changeOpenIssueCount(ctx: MutationCtx, projectId: Id<"projects">, delta: number) {
  const project = await ctx.db.get(projectId);
  if (!project) return;
  let count = project.openIssueCount;
  if (count === undefined) {
    count = 0;
    for await (const task of ctx.db.query("tasks").withIndex("by_project_and_done", q => q.eq("projectId", projectId).eq("done", false))) { if (task) count += 1; }
  } else count = Math.max(0, count + delta);
  await ctx.db.patch(projectId, { openIssueCount: count });
}

export function canEdit(member: RoleCarrier | Doc<"members"> | Doc<"teamMembers">) {
  return member.role === "owner" || member.role === "admin" || member.role === "member";
}
