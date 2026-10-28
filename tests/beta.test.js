import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import {
  performance,
  objectionCandidates,
} from "../server/beta/intelligence.js";
import { importProvider } from "../server/beta/providers.js";
import {
  zip,
  renderCarousel,
  validateCarousel,
} from "../server/beta/carousel.js";
async function setup(t, overrides = {}) {
  const db = openDatabase(":memory:"),
    directory = mkdtempSync(join(tmpdir(), "paid-beta-")),
    password = randomBytes(24).toString("hex");
  let fail = false;
  const app = createApp({
    db,
    seed: false,
    password,
    production: false,
    secretEncryptionKey: randomBytes(32).toString("hex"),
    betaDirectory: directory,
    verifyIntegration: async (p, k, a) => ({ id: a || p + "-test" }),
    importProvider: async () => {
      if (fail) throw Error("sensitive-upstream");
      return {
        records: [
          {
            externalId: "c1",
            kind: "call",
            title: "Setting fixture",
            occurredAt: new Date().toISOString(),
            data: {
              stage: "setting",
              transcript:
                "Prospect: I cannot afford the price. I need to ask my partner.",
            },
          },
        ],
        warnings: [],
      };
    },
    draftCampaign: async ({ evidence }) => ({
      summary: "Original campaign",
      sourceEvidence: evidence.map((e) => ({
        id: e.id,
        reason: "Confirmed concern",
      })),
      originalAdaptation: {
        angle: "Clarify expectations",
        sequence: [
          { format: "email", fullCopy: "Here is how to prepare." },
          {
            format: "carousel",
            shotList: ["Know what you need", "Choose your next step"],
          },
        ],
      },
      proofNeeded: [],
    }),
    ...overrides,
  });
  const server = app.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await app.waitForRefresh();
    await new Promise((r) => server.close(r));
    app.closeWorkspaceDatabases();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function actor() {
    let cookie = "",
      csrf = "";
    return {
      async req(
        path,
        {
          method = "GET",
          body,
          ws,
          raw,
          type,
          auth = true,
          extraHeaders = {},
        } = {},
      ) {
        const headers = {
          ...(auth ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
          ...(ws ? { "X-Workspace-Id": ws } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(type ? { "Content-Type": type } : {}),
          ...extraHeaders,
        };
        const r = await fetch(base + path, {
          method,
          headers,
          body: raw || (body ? JSON.stringify(body) : undefined),
        });
        const d = r.headers.get("content-type")?.includes("json")
          ? await r.json()
          : Buffer.from(await r.arrayBuffer());
        if (r.headers.get("set-cookie"))
          cookie = r.headers.get("set-cookie").split(";")[0];
        if (d.csrf) csrf = d.csrf;
        return { status: r.status, data: d };
      },
    };
  }
  const owner = actor();
  assert.equal(
    (
      await owner.req("/auth/login", {
        method: "POST",
        body: { email: "fraser@wearelevr.com", password },
      })
    ).status,
    200,
  );
  async function client(name) {
    const w = (
      await owner.req("/api/workspaces", { method: "POST", body: { name } })
    ).data;
    const invite = (
      await owner.req(`/api/workspaces/${w.id}/invites`, {
        method: "POST",
        body: { email: `${name}@example.test` },
      })
    ).data;
    const c = actor();
    assert.equal(
      (
        await c.req("/auth/accept-invite", {
          method: "POST",
          body: {
            email: `${name}@example.test`,
            password: randomBytes(24).toString("hex"),
            token: invite.token,
          },
        })
      ).status,
      200,
    );
    return { actor: c, id: w.id };
  }
  return {
    owner,
    client,
    app,
    fail: () => {
      fail = true;
    },
    db,
  };
}
test("paid evidence, integrations, jobs and failures remain workspace isolated", async (t) => {
  const s = await setup(t),
    a = await s.client("alpha"),
    b = await s.client("beta");
  for (const path of [
    "/api/beta/status",
    "/api/beta/evidence",
    "/api/beta/carousels",
    "/api/beta/analytics",
  ]) {
    assert.equal((await a.actor.req(path, { ws: b.id })).status, 404);
    assert.equal((await a.actor.req(path, { auth: false })).status, 401);
  }
  assert.equal(
    (
      await a.actor.req("/api/beta/integrations/meta", {
        method: "PUT",
        body: { apiKey: "synthetic-key", accountId: "123" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.actor.req("/api/beta/integrations/fathom", {
        method: "PUT",
        body: { apiKey: "synthetic-key", accountId: "a" },
      })
    ).status,
    200,
  );
  for (let n = 0; n < 2; n++) {
    assert.equal(
      (
        await a.actor.req("/api/beta/integrations/fathom/sync", {
          method: "POST",
        })
      ).status,
      202,
    );
    await s.app.waitForRefresh();
  }
  const rows = (await a.actor.req("/api/beta/evidence")).data;
  assert.equal(rows.length, 1);
  assert.equal((await b.actor.req("/api/beta/evidence")).data.length, 0);
  s.fail();
  await a.actor.req("/api/beta/integrations/fathom/sync", { method: "POST" });
  await s.app.waitForRefresh();
  assert.deepEqual((await a.actor.req("/api/beta/evidence")).data, rows);
  const jobs = (await a.actor.req("/api/beta/syncs")).data;
  assert.equal(jobs[0].status, "failed");
  assert.equal(JSON.stringify(jobs).includes("sensitive-upstream"), false);
});
test("call-grounded campaigns support comments, owner-only approval and revision invalidation", async (t) => {
  const s = await setup(t),
    a = await s.client("alpha"),
    b = await s.client("beta");
  const call = (
    await a.actor.req("/api/beta/evidence", {
      method: "POST",
      body: {
        kind: "call",
        title: "Closing call",
        stage: "closing",
        text: "Prospect: I need more proof before deciding.",
      },
    })
  ).data;
  assert.ok(call.id);
  const entry = {
    boardId: "objections-inbox",
    evidenceId: call.id,
    theme: "trust",
    excerpt: "Prospect: I need more proof before deciding.",
    confirmed: true,
  };
  assert.equal(
    (
      await a.actor.req("/api/beta/objections", {
        method: "POST",
        body: { ...entry, excerpt: "Invented words" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await a.actor.req("/api/beta/objections", { method: "POST", body: entry }))
      .status,
    200,
  );
  const made = await a.actor.req("/api/beta/campaigns", {
    method: "POST",
    body: {
      title: "Proof campaign",
      boardId: "objections-inbox",
      framework: "hpvc",
      formats: ["email", "carousel"],
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const c = made.data;
  assert.equal(
    (
      await a.actor.req(`/api/beta/campaigns/${c.id}/stage`, {
        method: "POST",
        body: { stage: "Approved", revision: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await s.owner.req(`/api/beta/campaigns/${c.id}/stage`, {
        method: "POST",
        ws: a.id,
        body: { stage: "Approved", revision: 1 },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await a.actor.req("/api/beta/comments", {
        method: "POST",
        body: {
          type: "campaigns",
          targetId: c.id,
          body: "Please clarify the second email.",
        },
      })
    ).status,
    201,
  );
  assert.equal(
    (await b.actor.req(`/api/beta/comments?type=campaigns&id=${c.id}`)).status,
    404,
  );
  const edited = await a.actor.req(`/api/beta/campaigns/${c.id}`, {
    method: "PATCH",
    body: { title: c.title, revision: 1, data: c.data },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.stage, "Draft");
  assert.equal(edited.data.approved_revision, null);
  assert.equal(
    (
      await s.owner.req(`/api/beta/campaigns/${c.id}/stage`, {
        method: "POST",
        ws: a.id,
        body: { stage: "Approved", revision: 1 },
      })
    ).status,
    409,
  );
});
test("private assets and carousel projects cannot cross workspaces and export valid images", async (t) => {
  const s = await setup(t),
    a = await s.client("alpha"),
    b = await s.client("beta");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N8sAAAAASUVORK5CYII=",
    "base64",
  );
  const up = await a.actor.req("/api/beta/assets", {
    method: "POST",
    raw: png,
    type: "image/png",
  });
  assert.equal(up.status, 201);
  assert.equal(
    (await b.actor.req(`/api/beta/assets/${up.data.id}`)).status,
    404,
  );
  assert.equal(
    (
      await a.actor.req("/api/beta/assets", {
        method: "POST",
        raw: png,
        type: "image/png",
      })
    ).data.id,
    up.data.id,
  );
  const c = (
    await a.actor.req("/api/beta/carousels", {
      method: "POST",
      body: { title: "Clear next steps", style: "brand" },
    })
  ).data;
  assert.equal(
    (await b.actor.req(`/api/beta/carousels/${c.id}/preview`)).status,
    404,
  );
  assert.equal(
    (await a.actor.req(`/api/beta/carousels/${c.id}/preview`)).data.slides
      .length,
    2,
  );
  const result = await a.actor.req(`/api/beta/carousels/${c.id}/export`, {
    method: "POST",
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.readUInt32LE(0), 0x04034b50);
  for (const name of [
    "01-slide.png",
    "contact-sheet.png",
    "images-only.zip",
    "editable/01.html",
    "caption.txt",
    "editable-project.json",
  ])
    assert.ok(result.data.includes(Buffer.from(name)), name);
});
test("analytics separates currencies, refunds, unknown metrics and source attribution", () => {
  const r = [
    {
      kind: "ad_day",
      data: {
        currency: "USD",
        spend: 100,
        impressions: 1000,
        linkClicks: 50,
        leads: 5,
        landingViews: 25,
        revenue: 200,
      },
    },
    { kind: "ad_day", data: { currency: "GBP", spend: 40, impressions: null } },
    {
      id: "p",
      kind: "payment",
      data: { currency: "USD", amountMinor: 20000, refundedMinor: 5000 },
    },
  ];
  const p = performance(r, [{ payment_id: "p" }]);
  assert.equal(p.currencies.length, 2);
  const usd = p.currencies.find((x) => x.currency === "USD");
  assert.equal(usd.metaRoas, 2);
  assert.equal(usd.collected, 150);
  assert.equal(usd.conversionRate, 20);
  assert.equal(p.currencies.find((x) => x.currency === "GBP").ctr, null);
  assert.equal(p.closeRate, null);
});
test("Stripe importer paginates and stores net-revenue ingredients without duplicating CRM revenue", async () => {
  let n = 0;
  const result = await importProvider("stripe", "test-key", "acct_fixture", {
    fetchImpl: async (url) => {
      n++;
      assert.equal(url.hostname, "api.stripe.com");
      assert.ok(url.searchParams.get("created[gte]"));
      return Response.json({
        data: [
          {
            id: "ch_" + n,
            paid: true,
            status: "succeeded",
            amount: 10000,
            amount_refunded: 1000,
            currency: "usd",
            created: Math.floor(Date.now() / 1000),
          },
        ],
        has_more: n === 1,
      });
    },
  });
  assert.equal(n, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].data.amountMinor, 10000);
});
test("photo validation refuses repeated assets and source suggestions remain grounded", () => {
  assert.throws(
    () =>
      validateCarousel(
        {
          style: "photo",
          slides: [
            {
              id: "1",
              heading: "One",
              body: "",
              photos: ["a"],
              layout: "single",
            },
            {
              id: "2",
              heading: "Two",
              body: "",
              photos: ["a"],
              layout: "single",
            },
          ],
        },
        [{ id: "a", mime: "image/png", sha256: "same" }],
      ),
    /repeat/,
  );
  const c = objectionCandidates([
    {
      id: "call",
      title: "Call",
      data: { transcript: "I cannot afford the price.", stage: "closing" },
    },
  ]);
  assert.equal(c[0].excerpt, "I cannot afford the price.");
  assert.equal(c.length, 1);
});
test("Meta OAuth callback rejects absent or forged state before any credential exchange", async (t) => {
  const s = await setup(t),
    a = await s.client("alpha");
  assert.equal(
    (
      await a.actor.req("/api/beta/meta/oauth/start", {
        method: "POST",
        body: { accountId: "123" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await s.owner.req("/oauth/meta/callback?state=forged&code=forged", {
        auth: false,
      })
    ).status,
    400,
  );
});
test("article extraction removes embedded instructions from executable contexts and blocks private addresses", async () => {
  const { publicIPv4, extractArticle } =
    await import("../server/beta/sources.js");
  for (const ip of [
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
    "192.168.0.1",
    "172.20.1.2",
    "0.0.0.0",
    "100.64.0.1",
  ])
    assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4("8.8.8.8"), true);
  const r = extractArticle(
    "<html><title>Source</title><script>secret()</script><article><h1>Useful lesson</h1><p>Original source &amp; context.</p></article></html>",
  );
  assert.equal(r.title, "Source");
  assert.ok(r.text.includes("Original source & context."));
  assert.equal(r.text.includes("secret"), false);
});

test("GHL uses date and message cursors and imports later call pages", async () => {
  const since = "2026-01-01T00:00:00Z",
    requests = [];
  const fetchImpl = async (input) => {
    const u = new URL(input);
    requests.push(u);
    let data;
    if (u.pathname === "/opportunities/search")
      data = { opportunities: [], meta: {} };
    else if (u.pathname === "/conversations/search") {
      assert.equal(u.searchParams.has("page"), false);
      data = {
        conversations: u.searchParams.has("startAfterDate")
          ? [
              {
                id: "later",
                lastMessageDate: "2026-02-01T00:00:00Z",
                contactId: "person",
              },
            ]
          : Array.from({ length: 100 }, (_, i) => ({
              id: `empty-${i}`,
              lastMessageDate: "2026-03-01T00:00:00Z",
            })),
      };
    } else if (u.pathname.includes("/transcription"))
      data = [{ startTime: 4, transcript: "I need more proof." }];
    else if (u.pathname.includes("/later/messages"))
      data = u.searchParams.has("lastMessageId")
        ? {
            messages: {
              messages: [
                { id: "call-two", type: 1, dateAdded: "2026-02-01T00:00:00Z" },
              ],
              nextPage: false,
            },
          }
        : {
            messages: [
              { id: "call-one", type: 1, dateAdded: "2026-02-02T00:00:00Z" },
            ],
            nextPage: true,
            lastMessageId: "call-one",
          };
    else data = { messages: [], nextPage: false };
    return Response.json(data);
  };
  const result = await importProvider(
    "ghl",
    "synthetic-only",
    "location-fixture",
    { fetchImpl, since },
  );
  assert.equal(result.records.filter((r) => r.kind === "call").length, 2);
  assert.ok(
    result.records.every((r) =>
      r.data.transcript.includes("I need more proof."),
    ),
  );
  assert.equal(
    requests.filter((u) => u.pathname === "/conversations/search").length,
    2,
  );
  assert.ok(
    requests.some((u) => u.searchParams.get("lastMessageId") === "call-one"),
  );
});

test("failed transcript refresh preserves the previous call transcript", async (t) => {
  let failed = false;
  const s = await setup(t, {
    importProvider: async () => ({
      records: [
        {
          externalId: "c1",
          kind: "call",
          title: "Call",
          data: {
            transcript: failed ? "" : "Prospect: I need more time.",
            transcriptStatus: failed ? "unavailable" : "available",
          },
        },
      ],
      warnings: failed ? ["Transcript unavailable"] : [],
    }),
  });
  const a = await s.client("alpha");
  await a.actor.req("/api/beta/integrations/fathom", {
    method: "PUT",
    body: { apiKey: "synthetic-only", accountId: "a" },
  });
  await a.actor.req("/api/beta/integrations/fathom/sync", { method: "POST" });
  await s.app.waitForRefresh();
  failed = true;
  await a.actor.req("/api/beta/integrations/fathom/sync", { method: "POST" });
  await s.app.waitForRefresh();
  const records = (await a.actor.req("/api/beta/evidence")).data;
  assert.equal(records.length, 1);
  assert.equal(records[0].data.transcript, "Prospect: I need more time.");
  assert.equal(
    records[0].data.transcriptStatus,
    "retained from previous import",
  );
});

test("media requires consent and retains source and transcript if retranscription fails", async (t) => {
  let fail = false;
  const s = await setup(t, {
    transcribeMedia: async () => {
      if (fail) throw Error("sensitive-upstream");
      return { transcript: "A grounded explanation.", segments: [] };
    },
  });
  const a = await s.client("alpha"),
    b = await s.client("beta");
  const upload = {
    method: "POST",
    raw: Buffer.from("isolated synthetic media fixture"),
    type: "video/mp4",
  };
  assert.equal((await a.actor.req("/api/beta/media", upload)).status, 400);
  upload.extraHeaders = { "X-Transcription-Consent": "true" };
  assert.equal((await a.actor.req("/api/beta/media", upload)).status, 201);
  fail = true;
  assert.equal((await a.actor.req("/api/beta/media", upload)).status, 201);
  const records = (await a.actor.req("/api/beta/evidence")).data;
  assert.equal(records.length, 1);
  assert.equal(records[0].data.transcript, "A grounded explanation.");
  assert.equal(
    records[0].data.transcriptStatus,
    "retained from previous import",
  );
  assert.equal(
    (await b.actor.req(`/api/beta/assets/${records[0].data.assetId}`)).status,
    404,
  );
  assert.equal(JSON.stringify(records).includes("sensitive-upstream"), false);
});

test("Meta OAuth stores a verified connection in the selected client workspace and rejects replay", async (t) => {
  const names = ["META_APP_ID", "META_APP_SECRET", "PUBLIC_BASE_URL"],
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.META_APP_ID = "synthetic-app";
  process.env.META_APP_SECRET = "synthetic-secret";
  process.env.PUBLIC_BASE_URL = "https://beta.example.test";
  t.after(() => {
    for (const n of names)
      if (previous[n] === undefined) delete process.env[n];
      else process.env[n] = previous[n];
  });
  let exchanges = 0;
  const s = await setup(t, {
    metaOAuth: {
      fetchImpl: async () => {
        exchanges++;
        return Response.json({ access_token: "synthetic-token-value" });
      },
      verifyConnection: async (p, key, id) => {
        assert.equal(p, "meta");
        assert.equal(id, "123");
        return { id: "act_123" };
      },
    },
  });
  const a = await s.client("alpha"),
    b = await s.client("beta");
  const start = await s.owner.req("/api/beta/meta/oauth/start", {
    method: "POST",
    ws: a.id,
    body: { accountId: "123" },
  });
  assert.equal(start.status, 200);
  const state = new URL(start.data.url).searchParams.get("state");
  const path = `/oauth/meta/callback?state=${encodeURIComponent(state)}&code=synthetic-code`;
  await s.owner.req(path);
  assert.equal(exchanges, 2);
  assert.equal(
    (await a.actor.req("/api/beta/integrations")).data.find(
      (p) => p.provider === "meta",
    ).configured,
    true,
  );
  assert.equal(
    (await b.actor.req("/api/beta/integrations")).data.find(
      (p) => p.provider === "meta",
    ).configured,
    false,
  );
  assert.equal((await s.owner.req(path)).status, 400);
  assert.equal(exchanges, 2);
});
