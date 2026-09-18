# Testing

Fast checks do not need a production connection:

```sh
npx tsc --noEmit
npx tsx scripts/test-document-sync.ts
npx tsx scripts/test-chat-composer.ts
npx tsx scripts/test-github-sync.ts
npx tsx scripts/test-call-signaling.ts
npx tsx scripts/test-dropped-content.ts
npx tsx scripts/test-file-drop.ts
npx tsx scripts/test-asset-uploads.ts
npm run build
```

Integration tests use a separate local Convex backend at `http://127.0.0.1:3210`, its HTTP endpoint at port 3211, and a local Origin server. They intentionally refuse non-localhost service URLs. Never copy production data into the fixtures.

`scripts/test-workspace.mjs` creates synthetic users, a workspace, projects, and `/tmp/origin-qa-session.json`. This temporary file contains test credentials; do not publish it. Set `TEST_CONVEX_URL` and `TEST_ORIGIN_URL` for your isolated environment before running the fixture.

Some integration suites read `/tmp/origin-integration-qa.env`. Supply the local Convex URLs, local Origin URL, test data directory, and a test-only `ORIGIN_INTEGRATION_SECRET` matching the isolated backend. Do not reuse a production secret. `scripts/test-features.mjs` covers collaborative documents, search, milestones, releases, public-feedback boundaries, and viewer/workspace authorization.

`scripts/test-github-lifecycle.mjs` covers real backend approval permissions, closure/reopen ordering, stale events, counters, and linked-issue badges. `scripts/test-project-fixes.mjs` also needs the isolated Origin server at port 3002; it covers local issue attachments, workspace isolation, viewer permissions, call-session renewal, and rejection of late signaling from previous sessions.

Browser QA should include fresh signup, desktop/mobile layouts, project feedback, chat mentions and attachments, and image previews in issues. Test a two-client call with simultaneous joining, screen sharing, camera toggling, and a full page refresh followed by rejoining while the other client stays connected. Also check GitHub issue closure sync and MCP authorization/revocation. Use synthetic media for automated call checks, then test physical devices across separate networks before claiming broad network coverage. A successful build is not a substitute for these checks.
