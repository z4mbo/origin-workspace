import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { normalizeEmail, requireAdmin, requireMember } from "./lib/permissions";
import { roleValidator } from "./lib/validators";

function makeInviteToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(500);
    return rows.map(row => ({ ...row, inviteToken: ["owner", "admin"].includes(member.role) ? row.inviteToken : undefined }));
  },
});

export const getInvite = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("members")
      .withIndex("by_token", (q) => q.eq("inviteToken", args.token))
      .unique();
    if (invite?.status === "invited") {
      const project = await ctx.db.get(invite.projectId);
      if (!project) return null;
      return {
        projectId: invite.projectId,
        projectName: project.name,
        email: invite.email,
        role: invite.role,
        invitedBy: invite.invitedBy,
      };
    }

    const teamInvite = await ctx.db
      .query("teamMembers")
      .withIndex("by_token", (q) => q.eq("inviteToken", args.token))
      .unique();
    if (!teamInvite || teamInvite.status !== "invited") return null;
    const team = await ctx.db.get(teamInvite.teamId);
    if (!team) return null;
    return {
      projectId: null,
      projectName: team.name,
      email: teamInvite.email,
      role: teamInvite.role,
      invitedBy: teamInvite.invitedBy,
    };
  },
});

export const invite = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdmin(ctx, args.projectId, args.sessionToken);
    if (args.role === "owner") throw new Error("Owner role cannot be invited");

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const now = Date.now();
    const email = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("members")
      .withIndex("by_project_email", (q) => q.eq("projectId", args.projectId).eq("email", email))
      .unique();

    if (existing?.status === "active") {
      throw new Error("Member already active");
    }

    const inviteToken = makeInviteToken();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name?.trim() || email,
        role: args.role,
        status: "invited",
        inviteToken,
        invitedBy: user.email,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("members", {
        projectId: args.projectId,
        email,
        name: args.name?.trim() || email,
        role: args.role,
        status: "invited",
        inviteToken,
        invitedBy: user.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { inviteToken, email, projectName: project.name, invitedBy: user.name || user.email };
  },
});

export const sendInvite = action({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    const result: { inviteToken: string; email: string; projectName: string; invitedBy: string } = await ctx.runMutation(
      api.members.invite,
      {
        projectId: args.projectId,
        sessionToken: args.sessionToken,
        email: args.email,
        name: args.name,
        role: args.role,
      },
    );
    const inviteLink = `${args.origin.replace(/\/$/, "")}/?invite=${result.inviteToken}`;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.INVITE_FROM_EMAIL || "Origin <onboarding@resend.dev>";

    if (!apiKey) {
      return { inviteLink, sent: false, reason: "RESEND_API_KEY not set" };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: result.email,
        subject: `You're invited to ${result.projectName} on Origin`,
        html: `<p>${result.invitedBy} invited you to <strong>${result.projectName}</strong> on Origin.</p><p><a href="${inviteLink}">Accept invite</a></p><p>If the button does not work, open this link:<br>${inviteLink}</p>`,
        text: `${result.invitedBy} invited you to ${result.projectName} on Origin. Accept: ${inviteLink}`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { inviteLink, sent: false, reason: `Email failed: ${response.status} ${body.slice(0, 160)}` };
    }

    return { inviteLink, sent: true, reason: "Email sent" };
  },
});

export const updateRole = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    memberId: v.id("members"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { member: requester } = await requireAdmin(ctx, args.projectId, args.sessionToken);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.projectId !== args.projectId) throw new Error("Member not found");
    if (member.role === "owner" && requester.role !== "owner") throw new Error("Owner role required");
    if (args.role === "owner" && requester.role !== "owner") throw new Error("Owner role required");
    await ctx.db.patch(args.memberId, { role: args.role, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    memberId: v.id("members"),
  },
  handler: async (ctx, args) => {
    const { member: requester, user } = await requireAdmin(ctx, args.projectId, args.sessionToken);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.projectId !== args.projectId) throw new Error("Member not found");
    if (member.role === "owner" && requester.role !== "owner") throw new Error("Owner role required");
    if (member.email === user.email) throw new Error("Cannot remove yourself");
    await ctx.db.delete(args.memberId);
  },
});
