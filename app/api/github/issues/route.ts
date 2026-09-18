import { githubProject } from "@/lib/githubLocal";
import { createGitHubTask } from "@/lib/github-sync";
import { getConvexClient, limitLocalAction, sessionTokenFromRequest } from "@/lib/localRealtime";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.projectId !== "string" || typeof body.taskId !== "string") throw new Error("Project and issue required");
    const sessionToken = sessionTokenFromRequest(request, body);
    const { user, project, token } = await githubProject(sessionToken, body.projectId, true);
    limitLocalAction(`github-create:${user._id}`, 20, 60000);
    if (!token && project.teamId && project.repoUrl && !project.githubWorkspaceAccess) {
      const client = getConvexClient();
      const workspace = await client.query(api.integrations.status, { sessionToken, teamId: project.teamId });
      if (workspace.connectedBy) {
        // Explicit issue creation by a workspace admin also approves this repository.
        // The mutation checks workspace membership, not the weaker project role.
        await client.mutation(api.integrations.approveRepository, { sessionToken, projectId: project._id, repoUrl: project.repoUrl });
      }
    }
    return Response.json(await createGitHubTask(body.projectId, body.taskId));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "GitHub issue creation failed" }, { status: 400 }); }
}
