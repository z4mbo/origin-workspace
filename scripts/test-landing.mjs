import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const [width, height] of [[1440, 900], [1920, 1080], [768, 1024], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await page.goto("http://127.0.0.1:3001/");
    await page.getByRole("heading", { name: "Origin", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelector("picture img")?.complete);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`);
    const nextSection = await page.locator("#workspace").boundingBox();
    assert.ok(nextSection.y < height - 20, `next section should be visible at ${width}x${height}`);
    await page.screenshot({ path: `/tmp/origin-landing-${width}.png`, fullPage: width === 1440 || width === 390, style: "nextjs-portal { display: none !important; }" });
    for (const name of ["Issues", "Chat", "Draw"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="tabpanel"] img')].filter(image => image.getClientRects().length).every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.getByRole("tabpanel").count(), 1);
    }
    console.log(`PASS landing ${width}x${height}: no overflow, next section visible, all product images loaded`);
  }
  await page.getByRole("tab", { name: "Issues", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Chat", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Questions" }).click();
  assert.equal(await page.getByRole("navigation", { name: "Mobile navigation" }).count(), 0);
  await page.getByText("Can I bring my team?", { exact: true }).click();
  assert.ok(await page.getByText("Yes. Create a named workspace", { exact: false }).isVisible());
  await page.getByRole("link", { name: "Create your workspace", exact: true }).first().click();
  await page.getByRole("heading", { name: "Make room for your next idea." }).waitFor();
  const id = Date.now();
  await page.getByLabel("Your name", { exact: true }).fill("Landing Test");
  await page.getByLabel("Email", { exact: true }).fill(`landing-${id}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(`Origin-browser-QA-${id}`);
  await page.getByLabel("Workspace name", { exact: true }).fill(`Studio ${id}`);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL(/studio-\d+/);
  await page.getByRole("button", { name: "Open navigation" }).waitFor();
  console.log("PASS keyboard tabs, mobile navigation, FAQ, landing CTA and real signup-to-workspace flow");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
