import { githubProject } from "@/lib/githubLocal";
import { createGitHubTask } from "@/lib/github-sync";
import { limitLocalAction, sessionTokenFromRequest } from "@/lib/localRealtime";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.projectId !== "string" || typeof body.taskId !== "string") throw new Error("Project and issue required");
    const { user } = await githubProject(sessionTokenFromRequest(request, body), body.projectId, true);
    limitLocalAction(`github-create:${user._id}`, 20, 60000);
    return Response.json(await createGitHubTask(body.projectId, body.taskId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GitHub issue creation failed" }, { status: 400 }); }
}
