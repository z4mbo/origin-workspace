import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const site = "http://127.0.0.1:3001";
const client = new ConvexHttpClient("http://127.0.0.1:3210");
const fixture = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
assert.ok(fixture.alex.user.email.endsWith("@example.test"));
const scope = { sessionToken: fixture.alex.sessionToken, teamId: fixture.workspace._id };
const mutation = (name, args) => client.mutation(makeFunctionReference(name), args);
const query = (name, args) => client.query(makeFunctionReference(name), args);
await mutation("auth:updateProfile", { sessionToken: fixture.alex.sessionToken, name: "Alex", username: "alex" });
await mkdir("public/landing", { recursive: true });
let sequence = 0;
function shape(type, x, y, width, height, options = {}) {
  return { id: `landing-${Date.now()}-${sequence++}`, type, x, y, width, height, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1.5, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: type === "rectangle" ? { type: 3 } : null, seed: 100 + sequence, version: 1, versionNonce: sequence * 321, isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false, ...options };
}
function text(x, y, value, color = "#1e1e1e", size = 22) {
  return shape("text", x, y, value.length * size * 0.57, size * 1.3, { text: value, originalText: value, fontSize: size, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, autoResize: true, lineHeight: 1.25, strokeColor: color });
}
function arrow(x, y, width, height, color = "#1971c2") {
  return shape("arrow", x, y, width, Math.abs(height), { points: [[0, 0], [width, height]], startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: "arrow", elbowed: false, strokeColor: color });
}
async function scene(elements) {
  const old = (await query("draw:scene", scope)).map(JSON.parse).filter(e => !e.isDeleted).map(e => ({ ...e, version: e.version + 1, isDeleted: true }));
  const all = [...old, ...elements];
  for (let start = 0; start < all.length; start += 100) await mutation("draw:updateElements", { ...scope, elements: all.slice(start, start + 100).map(e => JSON.stringify(e)) });
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 1 });
  await context.addInitScript(token => localStorage.setItem("origin.sessionToken", token), fixture.alex.sessionToken);
  const page = await context.newPage();
  await page.addStyleTag({ content: "" }).catch(() => {});
  const go = async view => {
    await page.goto(`${site}/${fixture.workspace.slug}?${view === "issues" ? `project=${fixture.projectId}` : `view=${view}`}`);
    await page.locator(".sidebar-project-list .project-button").first().waitFor({ state: "attached" });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    if (view === "draw") { await page.locator(".excalidraw canvas").first().waitFor(); await page.waitForTimeout(1200); }
  };
  const existing = await (await fetch(`${site}/api/local-chat/messages?teamId=${scope.teamId}`, { headers: { Authorization: `Bearer ${scope.sessionToken}` } })).json();
  for (const [who, body] of [[fixture.sam, "I sketched two directions for the onboarding flow. The simpler one feels right."], [fixture.alex, "Agreed. Let's keep the first step focused on creating a workspace."], [fixture.sam, "I'll take the mobile navigation. Want to jump into Draw together?"], [fixture.alex, "On my way. Added the next steps to the board."]]) {
    if (existing.messages?.some(message => message.body === body)) continue;
    await fetch(`${site}/api/local-chat/messages?teamId=${scope.teamId}`, { method: "POST", headers: { Authorization: `Bearer ${who.sessionToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ body, ...(who === fixture.alex ? { references: [{ type: "project", id: fixture.projectId, projectId: fixture.projectId, label: "Website" }] } : {}) }) });
  }
  await scene([
    shape("rectangle", -700, -250, 225, 145, { strokeColor: "#6741d9" }), text(-681, -224, "a new idea", "#6741d9", 26), text(-681, -181, "starts here", "#6741d9", 21), arrow(-545, -70, 73, 70, "#6741d9"),
    shape("rectangle", 474, -240, 150, 220, { strokeColor: "#0c8599" }), shape("rectangle", 490, -212, 118, 72, { strokeColor: "#0c8599" }), text(491, -118, "hello, world", "#0c8599", 15), shape("rectangle", 490, -72, 75, 22, { strokeColor: "#0c8599" }),
    text(-675, 196, "make it together", "#2f9e44", 25), shape("ellipse", -665, 267, 35, 35, { strokeColor: "#2f9e44" }), shape("ellipse", -620, 267, 35, 35, { strokeColor: "#2f9e44" }), shape("ellipse", -575, 267, 35, 35, { strokeColor: "#2f9e44" }),
    shape("diamond", 430, 120, 126, 100, { strokeColor: "#e8590c" }), arrow(563, 170, 77, 0, "#e8590c"), text(530, 258, "what's next?", "#e8590c", 22),
  ]);
  await page.setViewportSize({ width: 1850, height: 1050 });
  await go("draw");
  await page.locator(".excalidraw canvas").first().screenshot({ path: "public/landing/canvas.png", style: ".excalidraw * { visibility: hidden !important; } .excalidraw canvas { visibility: visible !important; } .drawing-status { visibility: hidden !important; }" });
  await scene([text(-185, -375, "a new idea", "#6741d9", 20), arrow(125, -340, 30, 40, "#0c8599"), text(-165, 345, "make it together", "#2f9e44", 20), shape("diamond", 135, 275, 42, 50, { strokeColor: "#e8590c" })]);
  await page.setViewportSize({ width: 390, height: 900 });
  await go("draw");
  await page.locator(".excalidraw canvas").first().screenshot({ path: "public/landing/canvas-mobile.png", style: ".excalidraw * { visibility: hidden !important; } .excalidraw canvas { visibility: visible !important; } .drawing-status { visibility: hidden !important; }" });
  await scene([
    text(-445, -230, "A better first hello", "#6741d9", 30), text(-445, -175, "Keep the first step simple.", "#1e1e1e", 18),
    shape("rectangle", -420, -90, 160, 90, { strokeColor: "#6741d9" }), text(-400, -59, "Create a space", "#6741d9", 18), arrow(-252, -45, 76, 0),
    shape("rectangle", -165, -90, 160, 90, { strokeColor: "#0c8599" }), text(-144, -59, "Invite your team", "#0c8599", 17), arrow(5, -45, 76, 0),
    shape("rectangle", 94, -90, 160, 90, { strokeColor: "#2f9e44" }), text(118, -59, "Make a start", "#2f9e44", 18),
    shape("rectangle", -170, 76, 175, 250, { strokeColor: "#0c8599" }), text(-143, 103, "Your workspace", "#0c8599", 17), shape("rectangle", -149, 153, 133, 30), text(-141, 160, "Studio", "#1e1e1e", 13), shape("rectangle", -149, 205, 133, 35, { strokeColor: "#6741d9" }), text(-114, 214, "Continue", "#6741d9", 13),
    text(74, 151, "Less setup.", "#e8590c", 25), text(74, 192, "More making.", "#e8590c", 25), arrow(68, 249, -60, 20, "#e8590c"),
  ]);
  for (const [suffix, viewport] of [["", { width: 1440, height: 820 }], ["-mobile", { width: 390, height: 760 }]]) {
    await page.setViewportSize(viewport);
    for (const view of ["issues", "chat", "draw"]) {
      await go(view);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `public/landing/${view}${suffix}.png` });
    }
  }
  console.log("Captured eight real Origin product images with synthetic workspace data.");
} finally { await browser.close(); }
