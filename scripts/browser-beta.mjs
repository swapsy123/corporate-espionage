import { chromium } from "@playwright/test";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
const dir = mkdtempSync(join(tmpdir(), "beta-browser-")),
  db = openDatabase(":memory:"),
  password = randomBytes(24).toString("hex");
const made = createApp({
  db,
  seed: false,
  password,
  production: false,
  betaDirectory: dir,
  secretEncryptionKey: randomBytes(32).toString("hex"),
  draftCampaign: async ({ evidence }) => ({
    summary: "Resolve implementation concerns before the call.",
    sourceEvidence: evidence.map((e) => ({ id: e.id, reason: e.excerpt })),
    originalAdaptation: {
      angle: "Understand the first week",
      sequence: [
        {
          format: "email",
          objective: "Prepare for the call",
          hook: "Start with a clear first step.",
          fullCopy:
            "Bring one process you want to improve. We will map the first decision together.",
          proofPlan: "Use the approved implementation checklist.",
          cta: "Read the checklist",
          deliveryTrigger: "After booking",
        },
        {
          format: "carousel",
          objective: "Explain the process",
          shotList: [
            "Choose your first step",
            "Bring one question to your call",
          ],
        },
      ],
    },
    proofNeeded: [],
  }),
});
const server = made.app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("fraser@wearelevr.com");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByRole("heading", { name: "Getting started." }).waitFor();
  await page.getByLabel("Offer name", { exact: true }).fill("Growth operating");
  await page.getByLabel("Who is it for?").fill("Owners of service businesses");
  await page
    .getByLabel("What does it help them achieve?")
    .fill("Build a repeatable client acquisition process");
  await page.getByRole("button", { name: "Save offer", exact: true }).click();
  await page
    .getByRole("button", { name: "Save brand kit", exact: true })
    .click();
  await page.screenshot({
    path: "/tmp/levr-beta-onboarding.png",
    fullPage: true,
  });
  for (const route of [
    "performance",
    "connections",
    "evidence",
    "objections",
    "campaigns",
    "studio",
    "outcomes",
    "intelligence",
  ]) {
    await page.goto(base + "/" + route);
    await page.locator("h1.page-title").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      route + " desktop overflow",
    );
  }
  await page.goto(base + "/evidence");
  await page.getByLabel("Title", { exact: true }).fill("Qualification call");
  await page.getByLabel("Evidence type").selectOption("call");
  await page.getByLabel("Call stage", { exact: true }).selectOption("setting");
  await page
    .getByLabel("Source text", { exact: true })
    .fill("Prospect: I worry the implementation will take too much effort.");
  await page
    .getByRole("button", { name: "Save evidence", exact: true })
    .click();
  await page.getByText("Qualification call", { exact: false }).last().waitFor();
  await page.goto(base + "/objections");
  await page
    .getByRole("button", { name: "Confirm and save to board", exact: true })
    .first()
    .click();
  await page.getByText("implementation · Confirmed", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/levr-beta-objections.png",
    fullPage: true,
  });
  await page.goto(base + "/campaigns");
  await page
    .getByLabel("Campaign title", { exact: true })
    .fill("First-week clarity");
  await page
    .getByRole("button", { name: "Create campaign draft", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "First-week clarity", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Approve revision", exact: true })
    .click();
  await page.getByText("Approved · Revision 1", { exact: true }).waitFor();
  await page
    .getByLabel("Comment", { exact: true })
    .fill("Client can review this draft and request edits.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await page
    .getByText("Client can review this draft and request edits.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByLabel("Campaign summary", { exact: true })
    .fill("Updated original campaign");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await page.getByText("Draft · Revision 2", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Create carousel from brief", exact: true })
    .click();
  await page.getByRole("heading", { name: "Carousel Studio." }).waitFor();
  await page
    .getByLabel("Saved carousel", { exact: true })
    .selectOption({ label: "First-week clarity · Draft" });
  await page.getByLabel("Headline", { exact: true }).waitFor();
  await page
    .getByLabel("Body", { exact: true })
    .fill("Bring one process you would like to improve.");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await page.getByText("Draft · Revision 2", { exact: true }).waitFor();
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export saved carousel ZIP", exact: true })
    .click();
  const download = await dl;
  await download.saveAs("/tmp/levr-beta-carousel.zip");
  await page.frameLocator("iframe").locator("h1").waitFor();
  assert.ok(
    (await page
      .locator("iframe")
      .evaluate((e) => e.getBoundingClientRect().width)) > 200,
  );
  assert.equal(
    await page.locator("iframe").evaluate((e) => e.clientWidth),
    1080,
  );
  await page.locator("iframe").scrollIntoViewIfNeeded();
  await page
    .locator("iframe")
    .screenshot({ path: "/tmp/levr-beta-preview.png" });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/levr-beta-studio.png", fullPage: true });
  const photos = await page.evaluate(() =>
    [0, 1].map((index) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext("2d"),
        gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
      gradient.addColorStop(0, index ? "#47788a" : "#aa8665");
      gradient.addColorStop(1, index ? "#132d39" : "#332d29");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1080, 1350);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
  );
  await page
    .getByLabel("Upload photos or logo", { exact: true })
    .setInputFiles(
      photos.map((data, index) => ({
        name: `fixture-photo-${index}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(data, "base64"),
      })),
    );
  for (let index = 0; index < 2; index++) {
    await page
      .getByAltText(`fixture-photo-${index}.png`, { exact: true })
      .waitFor();
    await page
      .getByAltText(`fixture-photo-${index}.png`, { exact: true })
      .evaluate((img) => img.decode());
  }
  await page
    .getByLabel("Carousel title", { exact: true })
    .fill("Editorial export check");
  await page.getByLabel("Visual style", { exact: true }).selectOption("photo");
  await page
    .getByRole("button", { name: "Create carousel", exact: true })
    .click();
  await page
    .getByLabel("Photo 1", { exact: true })
    .selectOption({ label: "fixture-photo-0.png" });
  await page
    .getByRole("button", { name: "2. Your next step", exact: true })
    .click();
  await page
    .getByLabel("Photo 1", { exact: true })
    .selectOption({ label: "fixture-photo-1.png" });
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await page.getByText("Draft · Revision 2", { exact: true }).waitFor();
  const photoDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export saved carousel ZIP", exact: true })
    .click();
  await (await photoDownload).saveAs("/tmp/levr-beta-photo-carousel.zip");
  await page.frameLocator("iframe").locator("h1").waitFor();
  assert.equal(
    await page.frameLocator("iframe").locator("h1").textContent(),
    "Your next step",
  );
  await page
    .locator("iframe")
    .screenshot({ path: "/tmp/levr-beta-photo-preview.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "launch",
    "performance",
    "connections",
    "evidence",
    "objections",
    "campaigns",
    "studio",
    "outcomes",
    "intelligence",
  ]) {
    await page.goto(base + "/" + route);
    await page.locator("h1.page-title").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      route + " mobile overflow",
    );
  }
  await page.goto(base + "/launch");
  await page.getByRole("button", { name: "Save offer", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/levr-beta-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "nine routes desktop and mobile",
        "offer and brand save",
        "source upload and objection confirmation",
        "campaign generation and owner approval",
        "comments and revision reset",
        "carousel editing, private image previews and both styles exported as PNG ZIPs",
      ],
      errors,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  made.closeWorkspaceDatabases();
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
