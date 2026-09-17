import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireUser } from "./lib/auth";
import { normalizeEmail, requireTeamAdmin, requireTeamMember } from "./lib/permissions";
import { roleValidator } from "./lib/validators";

function makeInviteToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export const listWithProjects = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .collect();

    const active = memberships.filter((membership) => membership.status === "active");
    const rows = await Promise.all(
      active.map(async (membership) => {
        const team = await ctx.db.get(membership.teamId);
        if (!team) return null;
        const projects = await ctx.db
          .query("projects")
          .withIndex("by_team", (q) => q.eq("teamId", team._id))
          .collect();
        return {
          ...team,
          memberRole: membership.role,
          projects: projects.sort((a, b) => b.updatedAt - a.updatedAt),
        };
      }),
    );

    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const create = mutation({
  args: { sessionToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.sessionToken);
    const now = Date.now();
    const teamId = await ctx.db.insert("teams", {
      name: args.name.trim(),
      ownerUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("teamMembers", {
      teamId,
      userId: user._id,
      email: user.email,
      name: user.name || user.email,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
      joinedAt: now,
    });
    return teamId;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const { member } = await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    if (member.role !== "owner") throw new Error("Owner role required");
    const projects = await ctx.db.query("projects").withIndex("by_team", (q) => q.eq("teamId", args.teamId)).collect();
    if (projects.length) throw new Error("Delete projects before deleting team");
    const members = await ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", args.teamId)).collect();
    for (const item of members) await ctx.db.delete(item._id);
    await ctx.db.delete(args.teamId);
  },
});

export const members = query({
  args: { sessionToken: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const { member } = await requireTeamMember(ctx, args.teamId, args.sessionToken);
    const rows = await ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", args.teamId)).take(500);
    return rows.map(row => ({ ...row, inviteToken: ["owner", "admin"].includes(member.role) ? row.inviteToken : undefined }));
  },
});

export const invite = mutation({
  args: {
    sessionToken: v.string(),
    teamId: v.id("teams"),
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    if (args.role === "owner") throw new Error("Owner role cannot be invited");
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");
    const now = Date.now();
    const email = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("teamMembers")
      .withIndex("by_team_email", (q) => q.eq("teamId", args.teamId).eq("email", email))
      .unique();
    if (existing?.status === "active") throw new Error("Member already active");
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
      await ctx.db.insert("teamMembers", {
        teamId: args.teamId,
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
    return { inviteToken, email, teamName: team.name, invitedBy: user.name || user.email };
  },
});

export const sendInvite = action({
  args: {
    sessionToken: v.string(),
    teamId: v.id("teams"),
    email: v.string(),
    name: v.optional(v.string()),
    role: roleValidator,
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    const result: { inviteToken: string; email: string; teamName: string; invitedBy: string } = await ctx.runMutation(
      api.teams.invite,
      {
        sessionToken: args.sessionToken,
        teamId: args.teamId,
        email: args.email,
        name: args.name,
        role: args.role,
      },
    );
    const inviteLink = `${args.origin.replace(/\/$/, "")}/?invite=${result.inviteToken}`;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.INVITE_FROM_EMAIL || "Origin <onboarding@resend.dev>";
    if (!apiKey) return { inviteLink, sent: false, reason: "RESEND_API_KEY not set" };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: result.email,
        subject: `You're invited to ${result.teamName} on Origin`,
        html: `<p>${result.invitedBy} invited you to <strong>${result.teamName}</strong> on Origin.</p><p><a href="${inviteLink}">Accept invite</a></p>`,
        text: `${result.invitedBy} invited you to ${result.teamName} on Origin. Accept: ${inviteLink}`,
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
  args: { sessionToken: v.string(), teamId: v.id("teams"), memberId: v.id("teamMembers"), role: roleValidator },
  handler: async (ctx, args) => {
    const { member: requester } = await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.teamId !== args.teamId) throw new Error("Member not found");
    if (member.role === "owner" || args.role === "owner") throw new Error("Workspace ownership cannot be changed here");
    await ctx.db.patch(args.memberId, { role: args.role, updatedAt: Date.now() });
  },
});

export const removeMember = mutation({
  args: { sessionToken: v.string(), teamId: v.id("teams"), memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const { member: requester, user } = await requireTeamAdmin(ctx, args.teamId, args.sessionToken);
    const member = await ctx.db.get(args.memberId);
    if (!member || member.teamId !== args.teamId) throw new Error("Member not found");
    if (member.role === "owner") throw new Error("The workspace owner cannot be removed");
    if (member.email === user.email) throw new Error("Cannot remove yourself");
    await ctx.db.delete(args.memberId);
  },
});
