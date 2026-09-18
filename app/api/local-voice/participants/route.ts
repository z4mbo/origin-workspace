import { NextResponse } from "next/server";
import {
  joinLocalVoice,
  leaveLocalVoice,
  listLocalVoiceParticipants,
  requireLocalWorkspace,
  sessionTokenFromRequest,
  updateLocalVoicePresence,
} from "@/lib/localRealtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireLocalWorkspace(request);
    return NextResponse.json({ participants: await listLocalVoiceParticipants(user), hosted: "origin-local" });
  } catch (error) {
    return errorResponse(error, 401);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      sessionToken?: string;
      action?: "join" | "update" | "leave";
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      teamId?: string;
      screenSharing?: boolean;
    };
    const user = await requireLocalWorkspace(request, body);
    if (body.action === "leave") {
      await leaveLocalVoice(user);
      return NextResponse.json({ ok: true, hosted: "origin-local" });
    }
    if (body.action === "update") {
      const participant = await updateLocalVoicePresence(user, !!body.audioEnabled, !!body.videoEnabled, !!body.screenSharing);
      return NextResponse.json({ userId: participant.userId, joinedAt: participant.joinedAt, hosted: "origin-local" });
    }
    const participant = await joinLocalVoice(user, !!body.audioEnabled, !!body.videoEnabled, !!body.screenSharing);
    return NextResponse.json({ userId: participant.userId, joinedAt: participant.joinedAt, hosted: "origin-local" });
  } catch (error) {
    return errorResponse(error);
  }
}
