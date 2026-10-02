# Origin Agent

One assistant for workspace work, project planning and issue triage. The default
subscription model is **GPT Luna (fast)** with **Model default** reasoning, resolved
from your Codex account's model catalog on each request. There is no silent model
or API-billing fallback.

## What it can do

- Read accessible projects, issues, comments, members, inbox and notifications.
- Read workspace chat and your own DMs, asset metadata/links and project documents.
- Propose project/issue changes, comments, columns, linked assets, documents,
  messages, invitations, member roles and workspace changes.
- Request a vault item by name. You open and unlock it privately in Origin;
  encrypted values, usernames, notes and passphrases are never sent to the model.
- Reformat an issue description from its small sparkle button. Review the result
  before applying it; editing the original invalidates an older preview.

Every write requires the requesting user's approval of the exact proposal. Normal
Origin permissions still apply. A shared runner never grants the admin's project
or chat access to another member. Deleting issues, assets or documents is permanent;
making a project inactive preserves it. Stop cannot undo a change already applied.

This is not a coding sandbox. It cannot execute commands, implement repository
code, inspect binary file contents, operate a camera, record a call or edit Draw.
Repository coding needs separate checkout isolation, command approvals and PR review.

## Choose a connection

Workspace owners/admins open **Agent > settings** to enable or disable Agent and
choose its connection, provider, model and reasoning:

| Mode | Account | Availability |
| --- | --- | --- |
| Local | Your ChatGPT subscription through the official Codex CLI | While your computer and companion are running |
| Own server | Your ChatGPT subscription through a private companion | While that server is online |
| API key | The admin's own OpenAI, Anthropic or OpenRouter key | Runs on the Origin application server |

Companions are personal by default. An admin can explicitly select an admin-owned
companion as the workspace runner. Members then share its account allowance, not
its Origin permissions. API mode is workspace-wide. Conversations are private to
their author through the application, though the server operator necessarily controls
the underlying storage. Use a shared runner only for a trusted workspace.

Provider terms, account eligibility, usage limits and model availability apply.
Origin does not promise unlimited use or that one personal subscription licenses
an organization. Subscription connections do not use an API key. Claude subscription
login is not supported: choose Anthropic API or use Origin's MCP from a Claude client.

## Connect a computer

1. Install Node.js 22+ and the official [Codex CLI](https://developers.openai.com/codex/cli).
2. Open **Agent > Connect companion** and choose your terminal platform.
3. Run the download command. It uses `~/.origin-agent/bin/origin-agent.mjs`, not
   your current working directory, so the sign-in and pairing commands work anywhere.
4. Sign in using the official ChatGPT device flow, then generate and run a pairing
   command. Pairing codes expire after ten minutes and work only once.
5. Keep the companion running. To reconnect later, run the same command without
   `--pair`. `--check` verifies the CLI and login without sending a prompt.

Connections last 90 days and can be revoked in Origin. Each domain has a separate
companion profile. Provider credentials remain on the companion machine, inside
its dedicated `~/.origin-agent/` directory, not in a teammate's browser.

## Run on a private server

The optional [Docker Compose service](../deploy/agent/compose.yml) has no inbound
ports, host checkout or Docker socket. It runs as a non-root user with a read-only
root filesystem and a dedicated writable credential directory.

From the repository root, on your server:

```sh
export ORIGIN_AGENT_URL=https://your-origin.example
export ORIGIN_AGENT_NAME="Workspace server"
export ORIGIN_AGENT_HOME=/var/lib/origin-agent
sudo install -d -m 700 -o 1000 -g 1000 "$ORIGIN_AGENT_HOME"
docker compose -f deploy/agent/compose.yml build
docker compose -f deploy/agent/compose.yml run --rm companion --origin "$ORIGIN_AGENT_URL" --login
docker compose -f deploy/agent/compose.yml run --rm companion --origin "$ORIGIN_AGENT_URL" --pair YOUR_ONE_USE_CODE
```

Once paired, stop that foreground command and start the persistent service:

```sh
docker compose -f deploy/agent/compose.yml up -d
```

Keep those environment settings in your deployment environment for subsequent
restarts. In Origin settings choose **Own server** and select the connected runner
to make it available to the workspace. Never commit login files or pairing tokens.
Headless device login uses the official [Codex authentication flow](https://learn.chatgpt.com/docs/auth).

## API keys

The admin supplies their own key in Agent settings. Keys are encrypted at rest
with the installation's integration encryption key and are never returned to the
browser or model. Removing the key or changing providers does not reuse another
provider's key. Disabling Agent, changing its connection/provider, or replacing
its key stops active work. Unsupported model/reasoning combinations report an error.

Prompts and requested content go to the configured provider. API use is billed by
that provider. No key is created automatically. Anthropic adaptive reasoning is
model-dependent; keep **Model default** unless the chosen model supports an override.

## Safety and testing

- Each request uses its author's scoped grant and checks live membership. Every
  write also requires the author's authenticated approval, not the runner owner's.
- Read-only companion grants remain read-only even after workspace-content consent.
- The existing MCP grants remain narrow; they do not gain chat or vault access.
- Formatting has no workspace tools and never saves until you choose Apply.
- Local shell, browsing, extra connectors and plugins are disabled in the companion.
- Preserve `ORIGIN_LOCAL_DATA_DIR` and the integration encryption key. The optional
  companion data directory contains account credentials and private conversation state.

```sh
npx tsc --noEmit
npx vitest run
node --test scripts/test-agent-companion.mjs
node scripts/test-agent-workflow.mjs
node scripts/test-agent-shared.mjs
```

Integration suites require isolated localhost fixtures. Provider adapters are
tested with synthetic responses without paid API requests. A signed-in companion
smoke test separately verifies real model responses and tool calls.
