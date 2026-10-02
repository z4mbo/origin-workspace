export type Release = { version: string; date: string; title: string; changes: { title: string; body: string }[] };

export const releases: Release[] = [{
  version: "1.1",
  date: "2026-09-27",
  title: "Your workspace, one Agent",
  changes: [
    { title: "One assistant for everyday work", body: "Planning, triage and workspace actions now live together. Ask about projects, issues, messages, documents and assets, then approve proposed changes." },
    { title: "Choose where Agent runs", body: "Connect Codex on your computer or private server, or use your own OpenAI, Anthropic or OpenRouter API key. Admins control availability, sharing, model and reasoning. Subscription companions default to GPT Luna with the model's default reasoning." },
    { title: "Polish an issue, keep the meaning", body: "Use the sparkle beside an issue description to generate a clearer version. Compare, edit and apply the preview when you are happy with it." },
    { title: "Shared compute, personal permissions", body: "A workspace runner uses the configured account allowance while respecting each member's access. Vault requests open privately in Origin; secrets are never sent to the model." },
  ],
}, {
  version: "1.0.1",
  date: "2026-09-27",
  title: "A smoother connection to Codex",
  changes: [
    { title: "One reliable companion path", body: "Download, sign in and pair with copyable commands that work from any folder. Choose macOS / Linux or PowerShell, and reconnect without downloading again." },
    { title: "Clearer pairing", body: "Expired codes can be replaced directly in the connection dialog. The companion now explains missing Codex installations and offers a local connection check." },
    { title: "The Origin plugin", body: "The plugin now includes the Origin brand icon. Its workspace-scoped access and approval requirements are unchanged." },
  ],
}, {
  version: "1.0",
  date: "2026-09-27",
  title: "A sharper workspace, with Agent",
  changes: [
    { title: "Agent in Origin", body: "Connect your own computer through the Origin companion and use your Codex login to work with projects and issues. Review and approve changes before they are applied." },
    { title: "Keyboard first", body: "C creates an issue. F, / or Cmd/Ctrl + K opens search. Enter opens the best match; arrow keys choose another result. In chat, typing returns to your message." },
    { title: "A cleaner issue editor", body: "Create issues from one compact row. Choose a project when starting outside a project, and select a priority explicitly. Searchable menus and mobile-sized date controls keep everything consistent." },
    { title: "A calmer sidebar", body: "Refined spacing, rounded-square avatars and a resizable sidebar. Your avatar moves with the project selection. Drag the sidebar edge left to collapse it, then use the top-left button to keep it open again." },
    { title: "One Inbox, two views", body: "Issues and notifications share the Inbox; empty notifications stay collapsed. Switch between List and Calendar beside Active and Completed, keeping your project and priority filters. Issue rows stay borderless until you hover." },
    { title: "Small details, fixed", body: "No extra borders while typing, no background flash in issue descriptions, and no leftover project highlight when collapsing the project list." },
  ],
}];

export const latestRelease = releases[0];
export function releaseStorageKey(userId: string) { return `origin.release-seen.${userId}`; }

export function isReleaseHistory(value: unknown): value is Release[] {
  return Array.isArray(value) && value.length > 0 && value.every(release =>
    release && typeof release.version === "string" && typeof release.title === "string" &&
    typeof release.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(release.date) &&
    Array.isArray(release.changes) && release.changes.every((change: unknown) => Boolean(change && typeof change === "object" && "title" in change && typeof change.title === "string" && "body" in change && typeof change.body === "string")),
  );
}
