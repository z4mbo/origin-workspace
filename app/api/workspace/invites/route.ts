import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { api } from "@/convex/_generated/api";
import { getConvexClient, limitLocalAction, requireLocalWorkspace, sessionTokenFromRequest } from "@/lib/localRealtime";
import { originUrl } from "@/lib/integration-bridge";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; role?: "admin" | "member" | "viewer" };
    const user = await requireLocalWorkspace(request);
    if (!["owner", "admin"].includes(user.workspaceRole)) throw new Error("Admin role required");
    limitLocalAction(`invite:${user.teamId}:${user._id}`, 20, 60000);
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address");
    const invite = await getConvexClient().mutation(api.workspaces.createInvite, { sessionToken: sessionTokenFromRequest(request), teamId: user.teamId, email, role: body.role || "member" });
    const inviteLink = `${originUrl()}/join/${invite.token}`;
    if (!process.env.ORIGIN_SMTP_HOST) return NextResponse.json({ inviteLink, sent: false });
    try {
      const transport = nodemailer.createTransport({ host: process.env.ORIGIN_SMTP_HOST, port: Number(process.env.ORIGIN_SMTP_PORT || "465"), secure: process.env.ORIGIN_SMTP_SECURE !== "false", auth: { user: process.env.ORIGIN_SMTP_USER, pass: process.env.ORIGIN_SMTP_PASSWORD }, connectionTimeout: 10000, socketTimeout: 15000 });
      await transport.sendMail({ from: process.env.ORIGIN_SMTP_FROM || process.env.ORIGIN_SMTP_USER, to: email, subject: `Join ${invite.teamName} on Origin`, text: `${user.name} invited you to ${invite.teamName}.\n\nJoin the workspace: ${inviteLink}\n\nThis invitation expires in 7 days.` });
      return NextResponse.json({ inviteLink, sent: true });
    } catch { return NextResponse.json({ inviteLink, sent: false }); }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invitation failed" }, { status: 400 }); }
}
