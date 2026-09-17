import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";
import { canEdit, normalizeEmail, requireAdmin, requireMember, requireTeamMember, touchProject } from "./lib/permissions";
import { callSignalKindValidator, projectIconTypeValidator, projectStatusValidator } from "./lib/validators";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const defaultColumns = ["Idea", "Todo", "In progress"];
const accents = ["#111111", "#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626"];
const callStaleMs = 30_000;

export const listForUser = query({
  args: { sessionToken: v.string(), teamId: v.optional(v.id("teams")) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    if (args.teamId) {
      const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
      const projects = await ctx.db.query("projects").withIndex("by_team", q => q.eq("teamId", args.teamId)).take(500);
      return await Promise.all(projects.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)).map(async project => ({
        ...project, memberRole: member.role,
        iconUrl: project.iconStorageId ? await ctx.storage.getUrl(project.iconStorageId) : null,
        openIssueCount: project.openIssueCount ?? (await ctx.db.query("tasks").withIndex("by_project_and_done", q => q.eq("projectId", project._id).eq("done", false)).take(1000)).length,
      })));
    }
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .collect();

    const rows = await Promise.all(
      memberships
        .filter((membership) => membership.status === "active")
        .map(async (membership) => {
          const project = await ctx.db.get(membership.projectId);
          if (!project) return null;
          if (project.teamId) {
            const workspaceMember = await ctx.db.query("teamMembers").withIndex("by_team_email", q => q.eq("teamId", project.teamId!).eq("email", user.email)).unique();
            if (workspaceMember?.status !== "active") return null;
          }
          return {
            ...project,
            memberRole: membership.role,
            iconUrl: project.iconStorageId ? await ctx.storage.getUrl(project.iconStorageId) : null,
          };
        }),
    );

    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    return {
      ...project,
      memberRole: member.role,
      iconUrl: project.iconStorageId ? await ctx.storage.getUrl(project.iconStorageId) : null,
    };
  },
});

export const stats = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireMember(ctx, args.projectId, args.sessionToken);
    const [tasks, commits, credentials, designAssets, members] = await Promise.all([
      ctx.db.query("tasks").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
      ctx.db.query("commits").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
      ctx.db.query("credentials").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
      ctx.db.query("designAssets").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect(),
      project.teamId
        ? ctx.db.query("teamMembers").withIndex("by_team", q => q.eq("teamId", project.teamId!)).take(500)
        : ctx.db.query("members").withIndex("by_project", q => q.eq("projectId", args.projectId)).take(500),
    ]);
    const doneTasks = tasks.filter((task) => task.done).length;
    return {
      tasks: tasks.length,
      doneTasks,
      progress: tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0,
      commits: commits.length,
      credentials: credentials.length,
      assets: designAssets.length,
      members: members.filter((member) => member.status === "active").length,
    };
  },
});

export const listChatMessages = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_project_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(80);
    return messages.reverse();
  },
});

export const sendChatMessage = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    const body = args.body.trim();
    if (!body) throw new Error("Message required");
    await ctx.db.insert("chatMessages", {
      projectId: args.projectId,
      authorUserId: user._id,
      authorName: user.username || user.name || user.email,
      authorEmail: user.email,
      body,
      createdAt: Date.now(),
    });
    await touchProject(ctx, args.projectId);
  },
});

export const listCallParticipants = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const cutoff = Date.now() - callStaleMs;
    const participants = await ctx.db
      .query("callParticipants")
      .withIndex("by_project_and_lastSeenAt", (q) => q.eq("projectId", args.projectId).gt("lastSeenAt", cutoff))
      .order("asc")
      .take(32);
    return await Promise.all(
      participants.map(async (participant) => ({
        ...participant,
        avatarUrl: participant.avatarStorageId ? await ctx.storage.getUrl(participant.avatarStorageId) : null,
      })),
    );
  },
});

export const joinCall = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    const now = Date.now();
    const existing = await ctx.db
      .query("callParticipants")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", args.projectId).eq("userId", user._id))
      .unique();
    const participant = {
      name: user.name || user.email,
      username: user.username,
      email: user.email,
      avatarStorageId: user.avatarStorageId,
      audioEnabled: args.audioEnabled,
      videoEnabled: args.videoEnabled,
      lastSeenAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, participant);
    } else {
      await ctx.db.insert("callParticipants", {
        projectId: args.projectId,
        userId: user._id,
        joinedAt: now,
        ...participant,
      });
    }
    return user._id;
  },
});

export const updateCallPresence = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    audioEnabled: v.boolean(),
    videoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    const existing = await ctx.db
      .query("callParticipants")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", args.projectId).eq("userId", user._id))
      .unique();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      audioEnabled: args.audioEnabled,
      videoEnabled: args.videoEnabled,
      lastSeenAt: Date.now(),
    });
    return existing._id;
  },
});

export const leaveCall = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    const existing = await ctx.db
      .query("callParticipants")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", args.projectId).eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);

    const incoming = await ctx.db
      .query("callSignals")
      .withIndex("by_project_and_to", (q) => q.eq("projectId", args.projectId).eq("toUserId", user._id))
      .take(100);
    for (const signal of incoming) await ctx.db.delete(signal._id);

    const outgoing = await ctx.db
      .query("callSignals")
      .withIndex("by_project_and_from", (q) => q.eq("projectId", args.projectId).eq("fromUserId", user._id))
      .take(100);
    for (const signal of outgoing) await ctx.db.delete(signal._id);
  },
});

export const sendCallSignal = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    toUserId: v.id("users"),
    kind: callSignalKindValidator,
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    if (args.toUserId === user._id) throw new Error("Cannot signal yourself");
    if (!args.payload) throw new Error("Signal payload required");
    if (args.payload.length > 80_000) throw new Error("Signal payload too large");
    const recipient = await ctx.db
      .query("callParticipants")
      .withIndex("by_project_and_user", (q) => q.eq("projectId", args.projectId).eq("userId", args.toUserId))
      .unique();
    if (!recipient || recipient.lastSeenAt < Date.now() - callStaleMs) throw new Error("Recipient is not in the call");
    await ctx.db.insert("callSignals", {
      projectId: args.projectId,
      fromUserId: user._id,
      toUserId: args.toUserId,
      kind: args.kind,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const listCallSignals = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    return await ctx.db
      .query("callSignals")
      .withIndex("by_project_and_to_and_createdAt", (q) => q.eq("projectId", args.projectId).eq("toUserId", user._id))
      .order("asc")
      .take(120);
  },
});

export const ackCallSignals = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), signalIds: v.array(v.id("callSignals")) },
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, args.projectId, args.sessionToken);
    for (const signalId of args.signalIds.slice(0, 120)) {
      const signal = await ctx.db.get(signalId);
      if (signal?.projectId === args.projectId && signal.toUserId === user._id) {
        await ctx.db.delete(signal._id);
      }
    }
  },
});

export const generateIconUploadUrl = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    sessionToken: v.string(),
    teamId: v.optional(v.id("teams")),
    name: v.string(),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    if (!args.teamId) throw new Error("Select a workspace before creating a project");
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    return createProjectRecord(ctx, { ...args, teamId: args.teamId }, user);
  },
});

export async function createProjectRecord(ctx: MutationCtx, args: { teamId: Id<"teams">; name: string; description?: string; repoUrl?: string }, user: Doc<"users">) {
  if (!args.name.trim() || args.name.length > 100) throw new Error("Enter a project name under 100 characters");
    const workspaceProjects = await ctx.db.query("projects").withIndex("by_team", q => q.eq("teamId", args.teamId)).take(500);
    const now = Date.now();
    const ownerEmail = normalizeEmail(user.email);
    const projectId = await ctx.db.insert("projects", {
      githubRepoState: args.repoUrl?.trim() ? undefined : "pending",
      teamId: args.teamId,
      openIssueCount: 0,
      order: Math.max(-1, ...workspaceProjects.map(p => p.order ?? 0)) + 1,
      name: args.name.trim(),
      description: args.description?.trim() || undefined,
      repoUrl: args.repoUrl?.trim() || undefined,
      status: "active",
      accent: accents[Math.floor(Math.random() * accents.length)],
      iconType: "default",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("members", {
      projectId,
      userId: user._id,
      email: ownerEmail,
      name: user.name || ownerEmail,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
      joinedAt: now,
    });

    for (const [index, title] of defaultColumns.entries()) {
      await ctx.db.insert("columns", {
        projectId,
        title,
        order: index,
        isDone: title === "Done",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!args.repoUrl?.trim()) await ctx.scheduler.runAfter(0, internal.integrations.kick, { projectId });
    return projectId;
}

export const reorder = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), projectIds: v.array(v.id("projects")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    if (args.projectIds.length > 500 || new Set(args.projectIds).size !== args.projectIds.length) throw new Error("Invalid project order");
    for (const [order, id] of args.projectIds.entries()) {
      const project = await ctx.db.get(id);
      if (!project || project.teamId !== args.teamId) throw new Error("Project does not belong to this workspace");
      await ctx.db.patch(id, { order });
    }
    return null;
  },
});

export const importRepos = mutation({
  args: {
    sessionToken: v.string(),
    repos: v.array(
      v.object({
        name: v.string(),
        repoUrl: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const ownerEmail = normalizeEmail(user.email);
    const existingProjects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerEmail", ownerEmail))
      .take(300);
    const existingRepoUrls = new Set(existingProjects.map((project) => project.repoUrl?.trim().toLowerCase()).filter(Boolean));
    const existingNames = new Set(existingProjects.map((project) => project.name.trim().toLowerCase()));
    const now = Date.now();
    const imported: Array<{ projectId: Id<"projects">; name: string; repoUrl: string; created: boolean }> = [];

    for (const repo of args.repos.slice(0, 100)) {
      const name = repo.name.trim();
      const repoUrl = repo.repoUrl.trim();
      if (!name || !repoUrl) continue;
      const normalizedRepoUrl = repoUrl.toLowerCase();
      const normalizedName = name.toLowerCase();
      const existing = existingProjects.find((project) => {
        return project.repoUrl?.trim().toLowerCase() === normalizedRepoUrl || project.name.trim().toLowerCase() === normalizedName;
      });
      if (existing || existingRepoUrls.has(normalizedRepoUrl) || existingNames.has(normalizedName)) {
        if (existing) imported.push({ projectId: existing._id, name: existing.name, repoUrl: existing.repoUrl || repoUrl, created: false });
        continue;
      }

      const projectId = await ctx.db.insert("projects", {
        name,
        description: repo.description?.trim() || `Imported from ${repoUrl}`,
        repoUrl,
        status: "active",
        accent: accents[imported.length % accents.length],
        iconType: "icon",
        iconValue: "repo",
        ownerEmail,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("members", {
        projectId,
        userId: user._id,
        email: ownerEmail,
        name: user.name || ownerEmail,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
        joinedAt: now,
      });
      for (const [index, title] of defaultColumns.entries()) {
        await ctx.db.insert("columns", {
          projectId,
          title,
          order: index,
          createdAt: now,
          updatedAt: now,
        });
      }
      imported.push({ projectId, name, repoUrl, created: true });
      existingRepoUrls.add(normalizedRepoUrl);
      existingNames.add(normalizedName);
    }

    return imported;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    // Accepted for older clients; project state is no longer editable.
    status: v.optional(projectStatusValidator),
    iconType: v.optional(projectIconTypeValidator),
    iconValue: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    const patch: Partial<{
      name: string;
      description: string | undefined;
      repoUrl: string | undefined;
      githubWorkspaceAccess: boolean;
      githubRepoId: number | undefined;
      iconType: "default" | "emoji" | "icon" | "image";
      iconValue: string | undefined;
      iconStorageId: Id<"_storage"> | undefined;
      updatedAt: number;
    }> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.description !== undefined) patch.description = args.description.trim() || undefined;
    if (args.repoUrl !== undefined) {
      patch.repoUrl = args.repoUrl.trim() || undefined;
      const project = await ctx.db.get(args.projectId);
      if (project?.repoUrl !== patch.repoUrl) { patch.githubWorkspaceAccess = false; patch.githubRepoId = undefined; }
    }
    if (args.iconType !== undefined) {
      patch.iconType = args.iconType;
      if (args.iconType !== "image") patch.iconStorageId = undefined;
      if (args.iconType === "default") patch.iconValue = undefined;
    }
    if (args.iconValue !== undefined) patch.iconValue = args.iconValue.trim() || undefined;
    if (args.iconStorageId !== undefined) patch.iconStorageId = args.iconStorageId;
    await ctx.db.patch(args.projectId, patch);
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.projectId, args.sessionToken);
    const tables = [
      "columns",
      "tasks",
      "taskComments",
      "taskAssets",
      "commits",
      "githubPullRequests",
      "wikiPages",
      "credentials",
      "designTokens",
      "designAssets",
      "chatMessages",
      "callParticipants",
      "callSignals",
      "members",
    ] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(args.projectId);
  },
});
