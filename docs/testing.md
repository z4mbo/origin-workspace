# Testing

Fast checks do not need a production connection:

```sh
npx tsc --noEmit
npx tsx scripts/test-document-sync.ts
npx tsx scripts/test-chat-composer.ts
npx tsx scripts/test-github-sync.ts
npm run build
```

Integration tests use a separate local Convex backend at `http://127.0.0.1:3210`, its HTTP endpoint at port 3211, and a local Origin server. They intentionally refuse non-localhost service URLs. Never copy production data into the fixtures.

`scripts/test-workspace.mjs` creates synthetic users, a workspace, projects, and `/tmp/origin-qa-session.json`. This temporary file contains test credentials; do not publish it. Set `TEST_CONVEX_URL` and `TEST_ORIGIN_URL` for your isolated environment before running the fixture.

Some integration suites read `/tmp/origin-integration-qa.env`. Supply the local Convex URLs, local Origin URL, test data directory, and a test-only `ORIGIN_INTEGRATION_SECRET` matching the isolated backend. Do not reuse a production secret. `scripts/test-features.mjs` covers collaborative documents, search, milestones, releases, public-feedback boundaries, and viewer/workspace authorization.

Browser QA should include fresh signup, desktop/mobile layouts, two simultaneous document editors, chat mentions and attachments, a two-client call with screensharing, GitHub issue closure sync, and MCP authorization/revocation. A successful build is not a substitute for these checks.
