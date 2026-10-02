import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { githubAppConfig, hashSecret, readGitHubJob, saveGitHubJob } from "@/lib/github-workspace";
import { syncGitHubEvent } from "@/lib/github-sync";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = githubAppConfig()?.webhookSecret;
  if (!secret) return new Response("Unavailable", { status: 503 });
  const body = await request.text(); const signature = request.headers.get("x-hub-signature-256") || "";
  if (body.length > 1000000 || !/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature.slice(7), "hex"), createHmac("sha256", secret).update(body).digest())) return new Response("Unauthorized", { status: 401 });
  if (request.headers.get("x-github-event") !== "issues") return Response.json({ accepted: true });
  const key = `delivery:${hashSecret(request.headers.get("x-github-delivery") || body)}`;
  if (readGitHubJob(key)?.state === "done") return Response.json({ accepted: true });
  try {
    const event = JSON.parse(body);
    const repo = event.repository?.full_name;
    if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return new Response("Invalid repository", { status: 400 });
    if (!Number.isInteger(event.issue?.number)) return new Response("Invalid issue", { status: 400 });
    after(async () => { await syncGitHubEvent(`https://github.com/${repo}`, event.issue.number); saveGitHubJob(key, "done"); });
    return Response.json({ accepted: true }, { status: 202 });
  } catch { return new Response("Invalid event", { status: 400 }); }
}
