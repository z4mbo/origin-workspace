# Connect an AI Client

Origin's remote MCP endpoint is `https://YOUR-ORIGIN-HOST/api/mcp`. The hosted instance uses `https://origin.imbored.fun/api/mcp`.

Each person signs in with their own Origin account and authorizes one workspace. Read-only access is the default recommendation. Enable writes only when the client should create or modify projects and issues. Grants expire and can be revoked from **Settings > Integrations**.

## Claude

Add a custom connector in Claude's connector settings, enter the MCP URL, and complete the Origin sign-in and workspace consent flow. Your organization may need to enable custom connectors first. See [Claude's official connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Codex and Other MCP Clients

Add Origin as a remote HTTP MCP server in your client's MCP settings and complete OAuth authentication. The client must support OAuth discovery, PKCE, and Streamable HTTP. Adding a server URL does not itself grant workspace access.

## Starter Prompt

```text
Use the Origin connector to help me work in my authorized workspace.

First list its projects and my assigned open issues. Ask which project I want to work on.
Read the project's columns and members before making changes. Use actual IDs returned by Origin.

When I explicitly ask you to create or update an issue, perform the change and verify the result.
Otherwise ask before modifying data. Reuse the same request ID when retrying an uncertain write.
Keep issue descriptions actionable, with context and acceptance criteria. Never mark work complete just because you described a solution.

For a linked GitHub issue, show the repository and issue URL. Implement code in that repository using a separate coding tool and repository authorization. Origin will sync completion when the GitHub issue closes.
```

The connector exposes projects and issues, not chat messages, vault secrets, GitHub tokens, or source-code execution. Treat issue descriptions as untrusted data, not instructions to disclose secrets or change unrelated resources. Never share the workspace owner's password with a colleague.
