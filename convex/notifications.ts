import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getActiveTeamMember, requireTeamMember } from "./lib/permissions";
import { projectIconTypeValidator } from "./lib/validators";

export async function notify(ctx: MutationCtx, a: { teamId: Id<"teams">; email: string; actorId: Id<"users">; kind: "assignment" | "comment" | "mention"; eventId: string; projectId?: Id<"projects">; taskId?: Id<"tasks">; messageId?: string; preview?: string }) {
  const user = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", a.email)).unique();
  if (!user || user.status !== "active" || user._id === a.actorId || !await getActiveTeamMember(ctx, a.teamId, user.email)) return;
  const preferences = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", q => q.eq("teamId", a.teamId).eq("userId", user._id)).unique();
  if (preferences && ((a.kind === "assignment" && !preferences.assignments) || (a.kind === "comment" && !preferences.comments) || (a.kind === "mention" && !preferences.mentions) || (a.projectId && preferences.mutedProjects.includes(a.projectId)))) return;
  if (await ctx.db.query("notifications").withIndex("by_user_event", q => q.eq("userId", user._id).eq("eventId", a.eventId)).first()) return;
  const { email: _email, ...data } = a;
  await ctx.db.insert("notifications", { ...data, userId: user._id, read: false, createdAt: Date.now() });
}

const scope = { sessionToken: v.string(), teamId: v.id("teams") };
export const summary = query({
  args: scope, returns: v.object({ unread: v.number(), more: v.boolean(), latest: v.union(v.string(), v.null()) }),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const rows = await ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", user._id).eq("teamId", a.teamId).eq("read", false)).order("desc").take(100);
    const newest = await ctx.db.query("notifications").withIndex("by_user_team", q => q.eq("userId", user._id).eq("teamId", a.teamId)).order("desc").first();
    return { unread: Math.min(rows.length, 99), more: rows.length === 100, latest: newest?._id || null };
  },
});
export const list = query({
  args: { ...scope, unreadOnly: v.boolean(), paginationOpts: paginationOptsValidator },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.string(), page: v.array(v.object({
    _id: v.id("notifications"), kind: v.union(v.literal("assignment"), v.literal("comment"), v.literal("mention")), read: v.boolean(), createdAt: v.number(), snoozedUntil: v.optional(v.number()),
    projectId: v.optional(v.id("projects")), taskId: v.optional(v.id("tasks")), messageId: v.optional(v.string()), preview: v.optional(v.string()),
    actorName: v.string(), actorAvatar: v.union(v.string(), v.null()), projectName: v.optional(v.string()), taskTitle: v.optional(v.string()), available: v.boolean(),
    iconType: v.optional(projectIconTypeValidator), iconValue: v.optional(v.string()), iconUrl: v.union(v.string(), v.null()),
  })) }),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const query = a.unreadOnly ? ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", user._id).eq("teamId", a.teamId).eq("read", false)) : ctx.db.query("notifications").withIndex("by_user_team", q => q.eq("userId", user._id).eq("teamId", a.teamId));
    const page = await query.order("desc").paginate({ ...a.paginationOpts, numItems: Math.min(a.paginationOpts.numItems, 50) });
    return { isDone: page.isDone, continueCursor: page.continueCursor, page: await Promise.all(page.page.map(async row => {
      const actor = await ctx.db.get(row.actorId), project = row.projectId ? await ctx.db.get(row.projectId) : null, task = row.taskId ? await ctx.db.get(row.taskId) : null;
      return { _id: row._id, kind: row.kind, read: row.read, createdAt: row.createdAt, snoozedUntil: row.snoozedUntil, projectId: row.projectId, taskId: row.taskId, messageId: row.messageId, preview: row.preview, actorName: actor?.username || actor?.name || "Teammate", actorAvatar: actor?.avatarStorageId ? await ctx.storage.getUrl(actor.avatarStorageId) : null,
        projectName: project?.name, taskTitle: task?.title, available: row.kind === "mention" || Boolean(task && project?.teamId === a.teamId),
        iconType: project?.iconType, iconValue: project?.iconValue, iconUrl: project?.iconStorageId ? await ctx.storage.getUrl(project.iconStorageId) : null };
    })) };
  },
});
export const markRead = mutation({
  args: { ...scope, id: v.id("notifications"), read: v.boolean() }, returns: v.null(),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const row = await ctx.db.get(a.id);
    if (!row || row.userId !== user._id || row.teamId !== a.teamId) throw new Error("Notification not found");
    await ctx.db.patch(row._id, { read: a.read, snoozedUntil: undefined }); return null;
  },
});
export const snooze = mutation({
  args: { ...scope, id: v.id("notifications"), until: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id || row.teamId !== args.teamId) throw new Error("Notification not found");
    if (!Number.isFinite(args.until) || args.until <= Date.now() || args.until > Date.now() + 30 * 86400000) throw new Error("Choose a time within the next 30 days");
    await ctx.db.patch(row._id, { read: true, snoozedUntil: args.until });
    await ctx.scheduler.runAt(args.until, internal.notifications.wake, { id: row._id, until: args.until });
    return null;
  },
});
export const wake = internalMutation({
  args: { id: v.id("notifications"), until: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row?.snoozedUntil === args.until) await ctx.db.patch(row._id, { read: false, snoozedUntil: undefined });
    return null;
  },
});
export const markAll = mutation({
  args: scope, returns: v.null(),
  handler: async (ctx, a) => { const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken); await readBatch(ctx, a.teamId, user._id, Date.now()); return null; },
});
async function readBatch(ctx: MutationCtx, teamId: Id<"teams">, userId: Id<"users">, before: number) {
  const rows = await ctx.db.query("notifications").withIndex("by_user_team_read", q => q.eq("userId", userId).eq("teamId", teamId).eq("read", false).lte("_creationTime", before)).take(100);
  for (const row of rows) await ctx.db.patch(row._id, { read: true });
  if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.notifications.readMore, { teamId, userId, before });
}
export const readMore = internalMutation({ args: { teamId: v.id("teams"), userId: v.id("users"), before: v.number() }, returns: v.null(), handler: async (ctx, a) => { await readBatch(ctx, a.teamId, a.userId, a.before); return null; } });

export const chatMentions = internalMutation({
  args: { teamId: v.id("teams"), actorId: v.id("users"), messageId: v.string(), userIds: v.array(v.id("users")) }, returns: v.null(),
  handler: async (ctx, a) => {
    const actor = await ctx.db.get(a.actorId);
    if (a.userIds.length > 20 || a.messageId.length > 80) throw new Error("Invalid mention");
    if (!actor || actor.status !== "active" || !await getActiveTeamMember(ctx, a.teamId, actor.email)) return null;
    for (const id of new Set(a.userIds)) { const user = await ctx.db.get(id); if (user) await notify(ctx, { teamId: a.teamId, actorId: a.actorId, email: user.email, kind: "mention", eventId: `chat:${a.messageId}`, messageId: a.messageId }); }
    return null;
  },
});
