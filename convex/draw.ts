import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canEdit, requireTeamMember } from "./lib/permissions";

export const scene = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") }, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    await requireTeamMember(ctx, args.teamId, args.sessionToken);
    return (await ctx.db.query("drawingElements").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(5000)).map(e => e.data);
  },
});
export const updateElements = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), elements: v.array(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    if (!canEdit(member)) throw new Error("Edit role required");
    if (args.elements.length > 200) throw new Error("Drawing update too large");
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Workspace not found");
    const rows = team.drawingElementCount === undefined ? await ctx.db.query("drawingElements").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(5001) : [];
    let count = team.drawingElementCount ?? rows.length;
    let bytes = team.drawingBytes ?? rows.reduce((sum, row) => sum + new TextEncoder().encode(row.data).byteLength, 0);
    for (const data of args.elements) {
      if (data.length > 64000) throw new Error("Drawing element is too large");
      const element = JSON.parse(data) as { id: string; version: number; versionNonce: number; type: string; x: number; y: number; width: number; height: number };
      if (!element || typeof element.id !== "string" || !element.id.length || element.id.length > 100 || !Number.isSafeInteger(element.version) || element.version < 1 || !Number.isSafeInteger(element.versionNonce) || ![element.x, element.y, element.width, element.height].every(Number.isFinite) || !["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame", "magicframe", "embeddable", "iframe"].includes(element.type)) throw new Error("Invalid drawing element");
      const existing = await ctx.db.query("drawingElements").withIndex("by_teamId_and_elementId", q => q.eq("teamId", args.teamId).eq("elementId", element.id)).unique();
      // Excalidraw versions and nonce tie-breaks preserve concurrent element edits.
      if (existing && (existing.version > element.version || (existing.version === element.version && existing.nonce <= element.versionNonce))) continue;
      count += existing ? 0 : 1;
      bytes += new TextEncoder().encode(data).byteLength - (existing ? new TextEncoder().encode(existing.data).byteLength : 0);
      if (count > 5000 || bytes > 6 * 1024 * 1024) throw new Error("Canvas is full. Export your drawing before starting a new one");
      const update = { version: element.version, nonce: element.versionNonce, data, updatedAt: Date.now() };
      if (existing) await ctx.db.patch(existing._id, update);
      else await ctx.db.insert("drawingElements", { teamId: args.teamId, elementId: element.id, ...update });
    }
    await ctx.db.patch(args.teamId, { drawingElementCount: count, drawingBytes: bytes });
    return null;
  },
});
export const presence = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") }, returns: v.any(),
  handler: async (ctx, args) => { await requireTeamMember(ctx, args.teamId, args.sessionToken); return ctx.db.query("drawingPresence").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(100); },
});
export const setPresence = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), x: v.number(), y: v.number(), button: v.union(v.literal("up"), v.literal("down")), leave: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const row = await ctx.db.query("drawingPresence").withIndex("by_teamId_and_userId", q => q.eq("teamId", args.teamId).eq("userId", user._id)).unique();
    if (args.leave) { if (row) await ctx.db.delete(row._id); return null; }
    if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error("Invalid pointer");
    const patch = { name: user.name, x: args.x, y: args.y, button: args.button, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, patch); else await ctx.db.insert("drawingPresence", { teamId: args.teamId, userId: user._id, ...patch });
    return null;
  },
});
export const files = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") }, returns: v.any(),
  handler: async (ctx, args) => { await requireTeamMember(ctx, args.teamId, args.sessionToken); const files = await ctx.db.query("drawingFiles").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(500); return Promise.all(files.map(async f => ({ fileId: f.fileId, mimeType: f.mimeType, url: await ctx.storage.getUrl(f.storageId) }))); },
});
export const uploadUrl = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams") }, returns: v.string(),
  handler: async (ctx, args) => { const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken); if (!canEdit(member)) throw new Error("Edit role required"); return ctx.storage.generateUploadUrl(); },
});
export const saveFile = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), fileId: v.string(), storageId: v.id("_storage"), mimeType: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken); if (!canEdit(member)) throw new Error("Edit role required");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size > 15 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(args.mimeType) || args.fileId.length > 100 || !args.fileId) throw new Error("Choose an image under 15 MB");
    const existing = await ctx.db.query("drawingFiles").withIndex("by_teamId_and_fileId", q => q.eq("teamId", args.teamId).eq("fileId", args.fileId)).unique();
    if (!existing) {
      const count = (await ctx.db.query("drawingFiles").withIndex("by_teamId", q => q.eq("teamId", args.teamId)).take(501)).length;
      if (count >= 500) throw new Error("This canvas has reached its image limit");
      await ctx.db.insert("drawingFiles", { teamId: args.teamId, fileId: args.fileId, storageId: args.storageId, mimeType: args.mimeType });
    }
    return null;
  },
});
