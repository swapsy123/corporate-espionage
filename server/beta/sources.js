import https from "node:https";
import { lookup } from "node:dns/promises";
import { IntegrationError } from "./providers.js";
export function publicIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return !(
    p[0] === 0 ||
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && (p[1] === 168 || p[1] === 0)) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && [18, 19, 51].includes(p[1])) ||
    (p[0] === 203 && p[1] === 0)
  );
}
export function extractArticle(html) {
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Imported article";
  let text = html.replace(
    /<(script|style|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " ",
  );
  const main = text.match(
    /<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i,
  );
  if (main) text = main[1];
  text = text
    .replace(/<\/(?:p|div|h[1-6]|li|section)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
  return {
    title: title.replace(/<[^>]+>/g, "").slice(0, 500),
    text: text.slice(0, 90000),
  };
}
export async function importArticle(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new IntegrationError("Enter a valid public HTTPS article URL.", 400);
  }
  for (let i = 0; i < 4; i++) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      throw new IntegrationError(
        "Only public HTTPS pages without URL credentials are supported.",
        400,
      );
    const host = url.hostname.toLowerCase();
    if (/(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com)$/.test(host))
      throw new IntegrationError(
        "For social videos, collect the original in Competitors or upload its transcript/media. A page title is not a transcript.",
        400,
      );
    let ips;
    try {
      ips = await lookup(host, { family: 4, all: true });
    } catch {
      throw new IntegrationError(
        "The article host could not be resolved. Paste the source text instead.",
        400,
      );
    }
    if (!ips.length || ips.some((x) => !publicIPv4(x.address)))
      throw new IntegrationError(
        "Private or reserved network destinations are not allowed.",
        400,
      );
    const ip = ips[0].address;
    const result = await new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: {
            Accept: "text/html,text/plain",
            "User-Agent": "LevrResearch/1.0",
          },
          lookup: (name, options, cb) =>
            cb(null, options.all ? [{ address: ip, family: 4 }] : ip, 4),
        },
        (res) => {
          let bytes = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 2_000_000) {
              req.destroy();
              reject(
                new IntegrationError(
                  "This page is too large. Upload its relevant text instead.",
                  400,
                ),
              );
            } else chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", () =>
            reject(
              new IntegrationError(
                "Article download failed. Paste the source text instead.",
              ),
            ),
          );
        },
      );
      req.setTimeout(15000, () => req.destroy());
      req.on("error", () =>
        reject(
          new IntegrationError(
            "Article access failed. Paste the source text instead.",
          ),
        ),
      );
    });
    if (
      [301, 302, 303, 307, 308].includes(result.status) &&
      result.headers.location
    ) {
      url = new URL(result.headers.location, url);
      continue;
    }
    if (result.status !== 200)
      throw new IntegrationError(
        `Article returned HTTP ${result.status}. Paste the accessible source text instead.`,
        400,
      );
    if (!/text\/(html|plain)/i.test(result.headers["content-type"] || ""))
      throw new IntegrationError(
        "This link is not a readable text page. Upload a transcript or supported media file.",
        400,
      );
    const data = extractArticle(result.text);
    if (data.text.length < 100)
      throw new IntegrationError(
        "Not enough article text was accessible. Paste the actual source instead.",
        400,
      );
    return { ...data, url: url.href };
  }
  throw new IntegrationError(
    "Too many redirects. Use the final public article URL.",
    400,
  );
}
