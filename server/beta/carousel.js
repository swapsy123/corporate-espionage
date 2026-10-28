import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const escape = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function validateCarousel(data, assets) {
  if (
    !["photo", "brand"].includes(data.style) ||
    !Array.isArray(data.slides) ||
    data.slides.length < 2 ||
    data.slides.length > 20
  )
    throw Error("Use 2–20 slides and a supported style.");
  const used = new Set();
  let totalBytes = 0;
  for (const s of data.slides) {
    if (
      !s.id ||
      typeof s.heading !== "string" ||
      s.heading.length > 180 ||
      typeof s.body !== "string" ||
      s.body.length > 900
    )
      throw Error(
        "Each slide needs a heading up to 180 characters and body up to 900.",
      );
    const photos = s.photos || [];
    if (photos.length && !["single", "collage"].includes(s.layout))
      throw Error("Choose a photo layout.");
    if (
      data.style === "photo" &&
      photos.length !== (s.layout === "collage" ? 4 : 1)
    )
      throw Error("Photo slides need one photo, or four for a collage.");
    for (const id of photos) {
      const a = assets.find((a) => a.id === id);
      if (!a || !a.mime.startsWith("image/"))
        throw Error("Select a photo from this workspace.");
      if (used.has(a.sha256))
        throw Error("A photo cannot repeat inside this carousel.");
      used.add(a.sha256);
      totalBytes += a.bytes || 0;
      if (totalBytes > 100_000_000)
        throw Error(
          "Selected photos exceed the 100 MB export limit. Upload smaller copies; originals remain saved.",
        );
    }
  }
}
export function slideHtml(slide, data, assets, readAsset) {
  const color = (v) => (/^#[a-f\d]{6}$/i.test(v || "") ? v : null);
  const bg = color(data.background) || "#fbfaf8",
    ink = color(data.ink) || "#121212",
    accent = color(data.accent) || "#b4442e";
  const image = (id) => {
    const a = assets.find((x) => x.id === id);
    return a ? `data:${a.mime};base64,${readAsset(id).toString("base64")}` : "";
  };
  const photo = data.style === "photo",
    font = ["Inter Tight", "Arial", "Georgia", "Times New Roman"].includes(
      data.font,
    )
      ? data.font
      : "Arial";
  const fontPath = new URL(
    "../../node_modules/@fontsource/inter-tight/files/inter-tight-latin-400-normal.woff2",
    import.meta.url,
  );
  let fontData = "";
  try {
    fontData = readFileSync(fontPath).toString("base64");
  } catch {}
  const pos = ["left", "right"].includes(slide.position)
    ? slide.position
    : "left";
  const images = (slide.photos || [])
    .map(
      (id) =>
        `<img src="${image(id)}" alt="" style="object-position:${Math.min(100, Math.max(0, Number(slide.cropX ?? 50)))}% ${Math.min(100, Math.max(0, Number(slide.cropY ?? 50)))}%">`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:'Inter Tight';src:url(data:font/woff2;base64,${fontData})}*{box-sizing:border-box}body{margin:0}.slide{width:1080px;height:1350px;position:relative;overflow:hidden;background:${bg};color:${photo ? "#fff" : ink}}.photos,.shade{position:absolute;inset:0}.photos{display:grid;grid-template-columns:${slide.layout === "collage" ? "1fr 1fr" : "1fr"};grid-template-rows:${slide.layout === "collage" ? "1fr 1fr" : "1fr"}}img{width:100%;height:100%;object-fit:cover;min-height:0}.shade{background:linear-gradient(${pos === "left" ? "90" : "270"}deg,rgba(0,0,0,.78),rgba(0,0,0,.15))}.content{position:relative;z-index:1;padding:90px 75px;height:100%;display:flex;flex-direction:column;align-items:${pos === "right" ? "flex-end" : "flex-start"};text-align:${pos};font-family:'${font}',Arial,sans-serif}h1{font-family:${photo ? "Georgia,serif" : `'${font}',Arial,sans-serif`};font-size:${slide.heading.length > 90 ? "74" : "96"}px;line-height:1.02;font-weight:${photo ? "400" : "600"};letter-spacing:-2px;max-width:900px;margin:0 0 44px;white-space:pre-wrap}p{font-size:38px;line-height:1.35;white-space:pre-wrap;max-width:${photo ? "620" : "900"}px;margin:0 0 30px}.rule{height:3px;width:194px;background:${photo ? "white" : accent};margin-bottom:38px}.takeaway{font-size:44px;line-height:1.2;font-style:italic;max-width:850px;margin-top:auto}.footer{font-size:24px;margin-top:35px;opacity:.8;display:flex;align-items:center;gap:20px}.logo{width:100px;height:70px;object-fit:contain}</style></head><body><section class="slide"><div class="photos">${images}</div>${photo ? '<div class="shade"></div>' : ""}<div class="content"><h1>${escape(slide.heading)}</h1><div class="rule"></div><p>${escape(slide.body)}</p><div class="takeaway">${escape(slide.takeaway)}</div><div class="footer">${data.logoId ? `<img class="logo" src="${image(data.logoId)}" alt="">` : ""}${escape(data.handle)}</div></div></section></body></html>`;
}
let rendererBusy = false;
export async function renderCarousel(data, assets, readAsset) {
  if (rendererBusy) {
    const error = Error(
      "Another carousel export is in progress. Retry when it finishes.",
    );
    error.code = "RENDER_BUSY";
    throw error;
  }
  rendererBusy = true;
  try {
    return await renderSlides(data, assets, readAsset);
  } finally {
    rendererBusy = false;
  }
}
async function renderSlides(data, assets, readAsset) {
  validateCarousel(data, assets);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const files = [],
    sources = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1350 },
      deviceScaleFactor: 1,
    });
    await page.route("**/*", (route) => route.abort());
    for (let i = 0; i < data.slides.length; i++) {
      const html = slideHtml(data.slides[i], data, assets, readAsset);
      sources.push({
        name: `editable/${String(i + 1).padStart(2, "0")}.html`,
        data: Buffer.from(html),
      });
      await page.setContent(html);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((im) => im.decode()));
      });
      const fits = await page.evaluate(() => {
        const c = document.querySelector(".content");
        const children = [...c.children];
        return (
          c.scrollHeight <= 1350 &&
          children.every(
            (e, i) =>
              e.getBoundingClientRect().bottom <= 1270 &&
              (!i ||
                e.getBoundingClientRect().top >=
                  children[i - 1].getBoundingClientRect().bottom - 1),
          )
        );
      });
      if (!fits)
        throw Error(
          `Slide ${i + 1} has too much text. Shorten it before export.`,
        );
      files.push({
        name: `${String(i + 1).padStart(2, "0")}-slide.png`,
        data: await page.screenshot({ type: "png" }),
      });
    }
    const imageFiles = [...files];
    await page.setViewportSize({
      width: 1080,
      height: Math.ceil(imageFiles.length / 4) * 350,
    });
    await page.setContent(
      `<html><body style="margin:0;background:#fbfaf8;display:grid;grid-template-columns:repeat(4,270px)">${imageFiles.map((f, i) => `<div style="padding:6px;font:14px Arial"><img style="width:258px;height:322px;object-fit:contain" src="data:image/png;base64,${f.data.toString("base64")}"><div>${i + 1}</div></div>`).join("")}</body></html>`,
    );
    await page.evaluate(() =>
      Promise.all([...document.images].map((im) => im.decode())),
    );
    files.push(
      {
        name: "contact-sheet.png",
        data: await page.screenshot({ type: "png", fullPage: true }),
      },
      { name: "images-only.zip", data: zip(imageFiles) },
      ...sources,
    );
    files.push(
      { name: "caption.txt", data: Buffer.from(data.caption || "") },
      {
        name: "editable-project.json",
        data: Buffer.from(JSON.stringify(data, null, 2)),
      },
    );
    return files;
  } finally {
    await browser.close();
  }
}
// Uncompressed ZIP, portable and dependency-free; CRC32 guards archive integrity.
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function zip(files) {
  let offset = 0;
  const local = [],
    central = [];
  for (const f of files) {
    const name = Buffer.from(f.name),
      data = Buffer.from(f.data),
      crc = crc32(data),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    local.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
