import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { authorize } from "./connectors";
import { hashToken, requireUser } from "./lib/auth";
import { requireTeamMember } from "./lib/permissions";
import { agentChange, agentRead } from "../lib/agent-contract";

export const enable = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), grantId: v.id("connectorGrants") }, returns: v.null(),
  handler: async (ctx, a) => {
    const { user } = await requireTeamMember(ctx, a.teamId, a.sessionToken);
    const grant = await ctx.db.get(a.grantId);
    if (!grant || grant.userId !== user._id || grant.teamId !== a.teamId || grant.revoked || grant.expiresAt <= Date.now()) throw new Error("Agent connection unavailable");
    await ctx.db.patch(grant._id, { agentAccess: true }); return null;
  },
});

export const identity = query({
  args: { token: v.string() },
  returns: v.object({ _id: v.id("users"), name: v.string(), email: v.string(), teamId: v.id("teams"), workspaceRole: v.string(), slug: v.string(), write: v.boolean(), extended: v.boolean(), grantId: v.id("connectorGrants"), expiresAt: v.number() }),
  handler: async (ctx, { token }) => {
    const { grant, user, member } = await authorize(ctx, token);
    const team = (await ctx.db.get(grant.teamId))!;
    return { _id: user._id, name: user.name, email: user.email, teamId: grant.teamId, workspaceRole: member.role, slug: team.slug || team._id, write: grant.write && member.role !== "viewer", extended: grant.agentAccess === true, grantId: grant._id, expiresAt: grant.expiresAt };
  },
});

export const read = query({
  args: { token: v.string(), request: v.string() }, returns: v.string(),
  handler: async (ctx, a) => {
    const r = agentRead.parse(JSON.parse(a.request));
    const { grant, member } = await authorize(ctx, a.token, false, r.projectId as Id<"projects"> | undefined);
    if (!grant.agentAccess) throw new Error("Enable workspace access in Agent connection settings first");
    const pagination = { numItems: 30, cursor: r.cursor || null };
    if (r.kind === "invitations") {
      if (!["owner", "admin"].includes(member.role)) throw new Error("Admin role required");
      const page = await ctx.db.query("workspaceInvites").withIndex("by_teamId", q => q.eq("teamId", grant.teamId)).order("desc").paginate(pagination);
      // Invite bearer tokens are deliberately omitted from discovery.
      return JSON.stringify({ invitations: page.page.map(({ _id, email, role, projectId, expiresAt, revoked }) => ({ id: _id, email, role, projectId, expiresAt, revoked })), nextCursor: page.isDone ? null : page.continueCursor });
    }
    if (!r.projectId) throw new Error("Choose a project first");
    const projectId = r.projectId as Id<"projects">;
    if (r.kind === "comments") {
      const task = r.taskId ? await ctx.db.get(r.taskId as Id<"tasks">) : null;
      if (!task || task.projectId !== projectId) throw new Error("Issue not found");
      const page = await ctx.db.query("taskComments").withIndex("by_task", q => q.eq("taskId", task._id)).order("desc").paginate(pagination);
      return JSON.stringify({ comments: page.page.map(({ _id, body, authorName, createdAt }) => ({ id: _id, body, authorName, createdAt })), nextCursor: page.isDone ? null : page.continueCursor });
    }
    if (r.kind === "vault") {
      const page = await ctx.db.query("credentials").withIndex("by_project", q => q.eq("projectId", projectId)).paginate(pagination);
      return JSON.stringify({ items: page.page.map(({ _id, title, kind }) => ({ id: _id, title, kind })), nextCursor: page.isDone ? null : page.continueCursor, disclosure: "Only item names and types are available. Request an item with request_vault; the user opens and unlocks it in their browser. Secrets and passphrases are never sent to the model." });
    }
    if (r.kind === "assets") {
      const page = await ctx.db.query("designAssets").withIndex("by_project", q => q.eq("projectId", projectId)).paginate(pagination);
      return JSON.stringify({ assets: await Promise.all(page.page.map(async ({ _id, name, type, url, storageId, contentType, size, notes }) => ({ id: _id, name, type, url: storageId ? await ctx.storage.getUrl(storageId) : url, contentType, size, notes }))), nextCursor: page.isDone ? null : page.continueCursor });
    }
    if (r.kind === "documents") {
      const page = await ctx.db.query("wikiPages").withIndex("by_project", q => q.eq("projectId", projectId)).paginate(pagination);
      return JSON.stringify({ documents: page.page.map(({ _id, title, type, updatedAt }) => ({ id: _id, title, type, updatedAt })), nextCursor: page.isDone ? null : page.continueCursor });
    }
    if (r.kind === "document") {
      const page = r.pageId ? await ctx.db.get(r.pageId as Id<"wikiPages">) : null;
      if (!page || page.projectId !== projectId) throw new Error("Document not found");
      return JSON.stringify({ id: page._id, title: page.title, content: page.content, tags: page.tags });
    }
    throw new Error("Unsupported read");
  },
});

// Reuse the application's mutations, including role checks, notifications and sync.
// Nested mutations and the idempotency record commit in one Convex transaction.
async function call<F extends FunctionReference<"mutation", "public">>(ctx: MutationCtx, fn: F, args: FunctionArgs<F>): Promise<unknown> {
  return ctx.runMutation(fn, args);
}
export const apply = mutation({
  args: { token: v.string(), sessionToken: v.string(), requestId: v.string(), change: v.string() }, returns: v.string(),
  handler: async (ctx, a): Promise<string> => {
    const c = agentChange.parse(JSON.parse(a.change));
    const { grant, user } = await authorize(ctx, a.token, c.kind !== "request_vault", "projectId" in c ? c.projectId as Id<"projects"> : undefined);
    if (!grant.agentAccess) throw new Error("Enable workspace access in Agent connection settings first");
    const requester = await requireUser(ctx, a.sessionToken);
    if (requester._id !== user._id) throw new Error("Only the requesting user can approve this action");
    if (a.requestId.length < 8 || a.requestId.length > 120) throw new Error("Invalid request ID");
    const key = await hashToken(JSON.stringify(c));
    const previous = await ctx.db.query("connectorOperations").withIndex("by_grantId_and_requestId", q => q.eq("grantId", grant._id).eq("requestId", a.requestId)).unique();
    if (previous) { const saved = JSON.parse(previous.result); if (saved.key !== key) throw new Error("Request ID already used"); return JSON.stringify(saved.result); }
    const sessionToken = a.sessionToken, teamId = grant.teamId;
    const projectId = "projectId" in c ? c.projectId as Id<"projects"> : undefined;
    const taskId = "taskId" in c ? c.taskId as Id<"tasks"> : undefined;
    let value: unknown;
    switch (c.kind) {
      case "create_project": value = { id: await call(ctx, api.projects.create, { sessionToken, teamId, name: c.name, description: c.description }) }; break;
      case "update_project": value = await call(ctx, api.projects.update, { sessionToken, projectId: projectId!, name: c.name, description: c.description, status: c.status }); break;
      case "delete_project": value = await call(ctx, api.projects.remove, { sessionToken, projectId: projectId! }); break;
      case "create_issue": value = { id: await call(ctx, api.tasks.createTask, { sessionToken, projectId: projectId!, columnId: c.columnId as Id<"columns">, title: c.title, description: c.description, priority: c.priority, assignedToEmail: c.assignedToEmail, dueDate: c.dueDate }) }; break;
      case "update_issue": value = await call(ctx, api.tasks.updateTask, { sessionToken, projectId: projectId!, taskId: taskId!, title: c.title, description: c.description, priority: c.priority, assignedToEmail: c.assignedToEmail, dueDate: c.dueDate, done: c.done }); break;
      case "delete_issue": value = await call(ctx, api.tasks.deleteTask, { sessionToken, projectId: projectId!, taskId: taskId! }); break;
      case "move_issue": value = await call(ctx, api.tasks.moveTask, { sessionToken, projectId: projectId!, taskId: taskId!, columnId: c.columnId as Id<"columns"> }); break;
      case "add_comment": value = await call(ctx, api.tasks.addComment, { sessionToken, projectId: projectId!, taskId: taskId!, body: c.body }); break;
      case "create_column": value = await call(ctx, api.tasks.createColumn, { sessionToken, projectId: projectId!, title: c.title }); break;
      case "update_column": value = await call(ctx, api.tasks.updateColumn, { sessionToken, projectId: projectId!, columnId: c.columnId as Id<"columns">, title: c.title }); break;
      case "delete_column": value = await call(ctx, api.tasks.deleteColumn, { sessionToken, projectId: projectId!, columnId: c.columnId as Id<"columns">, moveToColumnId: c.moveToColumnId as Id<"columns"> | undefined }); break;
      case "create_asset": value = await call(ctx, api.design.createAsset, { sessionToken, projectId: projectId!, name: c.name, type: c.type, url: c.url, notes: c.notes }); break;
      case "update_asset": value = await call(ctx, api.design.updateAsset, { sessionToken, projectId: projectId!, assetId: c.assetId as Id<"designAssets">, name: c.name, type: c.type, url: c.url, notes: c.notes }); break;
      case "delete_asset": value = await call(ctx, api.design.removeAsset, { sessionToken, projectId: projectId!, assetId: c.assetId as Id<"designAssets"> }); break;
      case "create_document": value = { id: await call(ctx, api.wiki.create, { sessionToken, projectId: projectId!, title: c.title, content: c.content, type: "wiki", tags: [] }) }; break;
      case "update_document": value = await call(ctx, api.wiki.update, { sessionToken, projectId: projectId!, pageId: c.pageId as Id<"wikiPages">, title: c.title, content: c.content }); break;
      case "delete_document": value = await call(ctx, api.wiki.remove, { sessionToken, projectId: projectId!, pageId: c.pageId as Id<"wikiPages"> }); break;
      case "invite_member": value = await call(ctx, api.workspaces.createInvite, { sessionToken, teamId, projectId, email: c.email, role: c.role }); break;
      case "revoke_invite": {
        const invite = await ctx.db.get(c.inviteId as Id<"workspaceInvites">);
        if (invite?.teamId !== teamId) throw new Error("Invitation not found");
        value = await call(ctx, api.workspaces.revokeInvite, { sessionToken, inviteId: invite._id }); break;
      }
      case "update_workspace": value = await call(ctx, api.workspaces.update, { sessionToken, teamId, name: c.name }); break;
      case "update_member": value = await call(ctx, api.teams.updateRole, { sessionToken, teamId, memberId: c.memberId as Id<"teamMembers">, role: c.role }); break;
      case "remove_member": value = await call(ctx, api.teams.removeMember, { sessionToken, teamId, memberId: c.memberId as Id<"teamMembers"> }); break;
      case "mark_notification": value = await call(ctx, api.notifications.markRead, { sessionToken, teamId, id: c.notificationId as Id<"notifications">, read: c.read }); break;
      case "request_vault": {
        const item = await ctx.db.get(c.credentialId as Id<"credentials">);
        if (!item || item.projectId !== projectId) throw new Error("Vault item not found");
        value = { title: item.title, projectId, credentialId: item._id, disclosure: "Open the vault in your browser. No secret was shared with AI." }; break;
      }
      default: throw new Error("This action requires the Origin server");
    }
    const result = value ?? { ok: true };
    await ctx.db.insert("connectorOperations", { grantId: grant._id, requestId: a.requestId, result: JSON.stringify({ key, result }) });
    return JSON.stringify(result);
  },
});
