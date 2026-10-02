import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const root = "/tmp/origin-agent-qa";
const binary = process.env.CONVEX_TEST_BINARY || path.join(homedir(), ".cache/convex/binaries/precompiled-2026-09-21-0cf49cb/convex-local-backend");
await mkdir(root, { recursive: true, mode: 0o700 });
let state;
try { state = JSON.parse(await readFile(`${root}/config.json`, "utf8")); }
catch { state = { secret: randomBytes(32).toString("hex"), integration: randomBytes(32).toString("hex") }; await writeFile(`${root}/config.json`, JSON.stringify(state), { mode: 0o600 }); }
const admin = execFileSync(binary, ["keygen", "admin-key", "--instance-name", "origin-agent-qa", "--instance-secret", state.secret], { encoding: "utf8" }).trim();
const env = { ...process.env, CONVEX_DEPLOYMENT: "", CONVEX_DEPLOY_KEY: "", CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210", CONVEX_SELF_HOSTED_ADMIN_KEY: admin,
  NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210", NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3211", ORIGIN_CONVEX_SITE_URL: "http://127.0.0.1:3211", ORIGIN_PUBLIC_URL: "http://127.0.0.1:3002", ORIGIN_SITE_URL: "http://127.0.0.1:3002", ORIGIN_LOCAL_DATA_DIR: `${root}/app`, ORIGIN_INTEGRATION_SECRET: state.integration,
  TEST_CONVEX_URL: "http://127.0.0.1:3210", TEST_ORIGIN_URL: "http://127.0.0.1:3002", ORIGIN_INTEGRATION_ENCRYPTION_KEY: state.integration, ORIGIN_GITHUB_ENABLED: "false" };
await writeFile("/tmp/origin-integration-qa.env", Object.entries(env).filter(([key]) => /^(CONVEX_|NEXT_PUBLIC_CONVEX_|ORIGIN_|TEST_)/.test(key)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
const mode = process.argv[2];
let child;
if (mode === "backend") child = spawn(binary, ["--interface", "127.0.0.1", "--port", "3210", "--site-proxy-port", "3211", "--instance-name", "origin-agent-qa", "--instance-secret", state.secret, "--local-storage", `${root}/storage`, "--disable-beacon", `${root}/backend.sqlite3`], { env, stdio: "inherit" });
else if (mode === "dev") child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"], { env, stdio: "inherit" });
else if (mode === "deploy") child = spawn(process.execPath, ["node_modules/convex/bin/main.js", "deploy", "--yes", "--env-file", "/tmp/origin-integration-qa.env"], { env, stdio: "inherit" });
else if (mode === "fixture") child = spawn(process.execPath, ["scripts/test-workspace.mjs"], { env, stdio: "inherit" });
else throw new Error("Choose backend, deploy, dev or fixture");
child.on("exit", code => { process.exitCode = code || 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
