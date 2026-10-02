import { NextResponse } from "next/server";
import {
  ackLocalVoiceSignals,
  listLocalVoiceSignals,
  requireLocalWorkspace,
  sendLocalVoiceSignal,
  sessionTokenFromRequest,
  type LocalVoiceSignal,
} from "@/lib/localRealtime";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireLocalWorkspace(request);
    return NextResponse.json({ signals: await listLocalVoiceSignals(user), hosted: "origin-local" });
  } catch (error) {
    return errorResponse(error, 401);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      sessionToken?: string;
      teamId?: string;
      toUserId?: Id<"users">;
      kind?: LocalVoiceSignal["kind"];
      payload?: string;
      fromJoinedAt?: number;
      toJoinedAt?: number;
    };
    const user = await requireLocalWorkspace(request, body);
    if (!body.toUserId || !body.kind) throw new Error("Signal target and kind required");
    const signal = await sendLocalVoiceSignal(user, body.toUserId, body.kind, body.payload || "", body.fromJoinedAt, body.toJoinedAt);
    return NextResponse.json({ signal, hosted: "origin-local" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { sessionToken?: string; teamId?: string; signalIds?: string[] };
    const user = await requireLocalWorkspace(request, body);
    await ackLocalVoiceSignals(user, body.signalIds || []);
    return NextResponse.json({ ok: true, hosted: "origin-local" });
  } catch (error) {
    return errorResponse(error);
  }
}
