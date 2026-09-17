import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_OWNER_EMAIL } from "@/convex/lib/auth";
import { requireLocalUser } from "@/lib/localRealtime";
import { consumeGithubState, githubAppConfig, saveGitHubApp } from "@/lib/github-workspace";
import { originUrl } from "@/lib/integration-bridge";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const state = consumeGithubState(request.nextUrl.searchParams.get("state") || "", request.cookies.get("origin.github")?.value || "", "setup");
    const user = await requireLocalUser(state.sessionToken);
    if (user.email !== DEFAULT_OWNER_EMAIL || githubAppConfig()) throw new Error("Setup unavailable");
    const code = request.nextUrl.searchParams.get("code"); if (!code || !/^[a-zA-Z0-9]+$/.test(code)) throw new Error("Invalid setup code");
    const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, { method: "POST", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
    const app = await response.json();
    if (!response.ok || !app.client_id || !app.client_secret || !app.slug || !app.webhook_secret) throw new Error("GitHub App setup failed");
    saveGitHubApp({ clientId: app.client_id, clientSecret: app.client_secret, slug: app.slug, webhookSecret: app.webhook_secret });
    return NextResponse.redirect(`${originUrl()}/${encodeURIComponent(state.slug)}?github=app-ready`);
  } catch { return NextResponse.redirect(`${originUrl()}/?github=setup-failed`); }
}
