import express from "express";
import { importArticle } from "./sources.js";
import { transcribeMedia } from "./media.js";
import { registerMetaOAuth } from "./meta-oauth.js";
import { z } from "zod";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createSecretVault } from "../secret-vault.js";
import {
  providers,
  verifyConnection,
  importProvider,
  IntegrationError,
} from "./providers.js";
import {
  frameworks,
  objectionCandidates,
  performance,
  draftCampaign,
  answerEvidence,
} from "./intelligence.js";
import {
  slideHtml,
  validateCarousel,
  renderCarousel,
  zip,
} from "./carousel.js";
const now = () => new Date().toISOString(),
  uid = () => randomUUID(),
  parse = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
const short = z.string().trim().min(1).max(300),
  date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stages = [
  "Draft",
  "In review",
  "Approved",
  "In production",
  "Live",
  "Reviewed",
];
export function registerBeta(app, { db, catalog, manager, options = {} }) {
  const root = catalog
    .prepare("PRAGMA database_list")
    .all()
    .find((x) => x.name === "main")?.file;
  const directory =
    options.betaDirectory ||
    (root ? join(dirname(root), "beta") : join(tmpdir(), `levr-beta-${uid()}`));
  const vaults = Object.fromEntries(
    providers.map((p) => [
      p,
      createSecretVault({
        directory: join(directory, "credentials", p),
        masterKey: options.secretEncryptionKey,
        ownerKey: "",
      }),
    ]),
  );
  registerMetaOAuth(app, {
    catalog,
    manager,
    vault: vaults.meta,
    options: options.metaOAuth || {},
  });
  const getSetting = (key) =>
    JSON.parse(
      db.prepare("SELECT data FROM beta_settings WHERE key=?").get(key)?.data ||
        "{}",
    );
  const evidence = () =>
    db
      .prepare("SELECT * FROM evidence ORDER BY occurred_at DESC")
      .all()
      .map(parse);
  const getEvidence = (id) =>
    parse(db.prepare("SELECT * FROM evidence WHERE id=?").get(id));
  const own = (req, res, next) =>
    req.user.role === "owner"
      ? next()
      : res.status(403).json({
          error:
            "Only the Levr owner can approve or manage agency connections.",
        });
  const audit = (req, action, id) =>
    db
      .prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)")
      .run(uid(), req.user.email, action, id, now());
  const assets = () =>
    db.prepare("SELECT * FROM assets ORDER BY created_at DESC").all();
  const assetDir = (ws) => join(directory, "assets", ws);
  const readAsset = (ws, id) => readFileSync(join(assetDir(ws), id));
  const find = (table, id) => {
    const r = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!r)
      throw new IntegrationError("Record not found in this workspace.", 404);
    return r;
  };
  const busy = new Set(),
    tasks = new Set();
  const integrationStatus = () =>
    providers.map((provider) => {
      const r = db
        .prepare("SELECT * FROM integrations WHERE provider=?")
        .get(provider);
      return {
        provider,
        ...r,
        configured: !!r,
        agencyManaged: ["meta", "ghl"].includes(provider),
        oauthAvailable:
          provider === "meta" &&
          !!(
            process.env.META_APP_ID &&
            process.env.META_APP_SECRET &&
            process.env.PUBLIC_BASE_URL
          ),
      };
    });
  app.get("/api/beta/status", (req, res) =>
    res.json({
      application: "Levr Intelligence Beta",
      workspace: req.workspace,
      offer: getSetting("offer"),
      brand: getSetting("brand"),
      frameworks,
      integrations: integrationStatus(),
      counts: {
        evidence: db.prepare("SELECT count(*) n FROM evidence").get().n,
        campaigns: db.prepare("SELECT count(*) n FROM campaigns").get().n,
        carousels: db.prepare("SELECT count(*) n FROM carousels").get().n,
      },
      aiReady: !!process.env.LEVR_AI_API_KEY,
    }),
  );
  app.get("/api/beta/profile/:kind", (req, res) => {
    if (!["offer", "brand"].includes(req.params.kind))
      return res.sendStatus(404);
    res.json(getSetting(req.params.kind));
  });
  app.put("/api/beta/profile/:kind", (req, res) => {
    if (!["offer", "brand"].includes(req.params.kind))
      return res.sendStatus(404);
    const schema =
      req.params.kind === "offer"
        ? z.object({
            name: short,
            audience: z.string().max(5000),
            promise: z.string().max(5000),
            price: z.string().max(200),
            proof: z.string().max(12000),
            salesProcess: z.string().max(5000),
            voice: z.string().max(5000),
            website: z.string().max(1000),
            cta: z.string().max(2000),
          })
        : z.object({
            name: z.string().max(200),
            background: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            ink: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            accent: z.string().regex(/^#[a-fA-F0-9]{6}$/),
            font: z.enum([
              "Inter Tight",
              "Arial",
              "Georgia",
              "Times New Roman",
            ]),
            voice: z.string().max(8000),
            notes: z.string().max(20000),
            logoId: z.string().max(100).optional(),
          });
    const v = schema.parse(req.body);
    if (v.logoId && !assets().some((a) => a.id === v.logoId))
      throw new IntegrationError("Choose a logo from this workspace.", 400);
    db.prepare(
      "INSERT INTO beta_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
    ).run(req.params.kind, JSON.stringify(v));
    audit(req, "profile.updated", req.params.kind);
    res.json(v);
  });
  app.get("/api/beta/integrations", (req, res) =>
    res.json(integrationStatus()),
  );
  app.put("/api/beta/integrations/:provider", async (req, res) => {
    const p = z.enum(providers).parse(req.params.provider);
    if (["meta", "ghl"].includes(p) && req.user.role !== "owner")
      return res.status(403).json({
        error:
          "Levr connects the agency-managed Meta and GoHighLevel accounts.",
      });
    const v = z
      .object({
        apiKey: z.string().trim().min(8).max(4000),
        accountId: z.string().trim().max(150),
      })
      .parse(req.body);
    const remote = await (options.verifyIntegration || verifyConnection)(
      p,
      v.apiKey,
      v.accountId,
    );
    const accountId = String(remote.id || v.accountId);
    // Keep agency account assignment separate from each workspace's research.
    catalog.exec(
      "CREATE TABLE IF NOT EXISTS beta_account_bindings(provider TEXT,account_id TEXT,workspace_id TEXT,PRIMARY KEY(provider,account_id))",
    );
    const existing = catalog
      .prepare(
        "SELECT workspace_id FROM beta_account_bindings WHERE provider=? AND account_id=?",
      )
      .get(p, accountId);
    if (
      ["meta", "ghl", "stripe"].includes(p) &&
      existing &&
      existing.workspace_id !== req.workspaceId
    )
      throw new IntegrationError(
        "That account is already assigned to another workspace.",
        409,
      );
    vaults[p].set(req.workspaceId, v.apiKey, { verifiedAt: now() });
    if (["meta", "ghl", "stripe"].includes(p))
      catalog
        .prepare("INSERT OR IGNORE INTO beta_account_bindings VALUES (?,?,?)")
        .run(p, accountId, req.workspaceId);
    db.prepare(
      "INSERT INTO integrations(provider,account_id,connected_at) VALUES (?,?,?) ON CONFLICT(provider) DO UPDATE SET account_id=excluded.account_id,connected_at=excluded.connected_at,last_error=NULL",
    ).run(p, p === "meta" ? accountId.replace(/^act_/, "") : accountId, now());
    audit(req, "integration.connected", p);
    res.json({ provider: p, configured: true });
  });
  app.delete("/api/beta/integrations/:provider", (req, res) => {
    const p = z.enum(providers).parse(req.params.provider);
    if (["meta", "ghl"].includes(p) && req.user.role !== "owner")
      return res.status(403).json({ error: "Levr manages this connection." });
    if (busy.has(`${req.workspaceId}:${p}`))
      throw new IntegrationError("Wait for the current import to finish.", 409);
    vaults[p].delete(req.workspaceId);
    db.prepare("DELETE FROM integrations WHERE provider=?").run(p);
    catalog.exec(
      "CREATE TABLE IF NOT EXISTS beta_account_bindings(provider TEXT,account_id TEXT,workspace_id TEXT,PRIMARY KEY(provider,account_id))",
    );
    catalog
      .prepare(
        "DELETE FROM beta_account_bindings WHERE provider=? AND workspace_id=?",
      )
      .run(p, req.workspaceId);
    audit(req, "integration.disconnected", p);
    res.json({ ok: true });
  });
  app.post("/api/beta/integrations/:provider/sync", (req, res) => {
    const p = z.enum(providers).parse(req.params.provider),
      integration = db
        .prepare("SELECT * FROM integrations WHERE provider=?")
        .get(p);
    if (!integration)
      throw new IntegrationError("Connect this account first.", 400);
    const scope = `${req.workspaceId}:${p}`;
    if (busy.has(scope))
      throw new IntegrationError("This account is already importing.", 409);
    const key = vaults[p].get(req.workspaceId);
    if (!key)
      throw new IntegrationError("Reconnect this account in Connections.", 400);
    const job = uid(),
      connection = req.workspaceDatabase,
      workspace = req.workspaceId;
    db.prepare(
      "INSERT INTO sync_runs(id,provider,started_at,status) VALUES (?,?,?,?)",
    ).run(job, p, now(), "running");
    busy.add(scope);
    const task = manager.run(connection, workspace, async () => {
      try {
        const result = await (options.importProvider || importProvider)(
          p,
          key,
          integration.account_id,
        );
        const rows = z
          .array(
            z.object({
              kind: short,
              externalId: short,
              title: z.string().max(2000),
              occurredAt: z.string().nullable().optional(),
              data: z.record(z.string(), z.unknown()),
            }),
          )
          .max(200000)
          .parse(result.records);
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const r of rows) {
            const previous = db
              .prepare(
                "SELECT data FROM evidence WHERE provider=? AND kind=? AND external_id=?",
              )
              .get(p, r.kind, r.externalId);
            if (previous) {
              const old = JSON.parse(previous.data);
              if (
                old.transcript &&
                !r.data.transcript &&
                r.data.transcriptStatus === "unavailable"
              ) {
                r.data.transcript = old.transcript;
                r.data.segments = old.segments;
                r.data.transcriptStatus = "retained from previous import";
              }
              if (old.stats && r.data.stats === null) {
                r.data.stats = old.stats;
                r.data.statsScope =
                  "Retained from previous import; latest engagement request failed.";
              }
            }
            db.prepare(
              "INSERT INTO evidence VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider,kind,external_id) DO UPDATE SET occurred_at=excluded.occurred_at,title=excluded.title,data=excluded.data",
            ).run(
              uid(),
              p,
              r.externalId,
              r.kind,
              r.occurredAt || null,
              r.title,
              JSON.stringify(r.data),
            );
          }
          db.prepare(
            "UPDATE sync_runs SET status='success',finished_at=?,record_count=?,error=? WHERE id=?",
          ).run(
            now(),
            rows.length,
            (result.warnings || []).join(" ").slice(0, 20000) || null,
            job,
          );
          db.prepare(
            "UPDATE integrations SET last_success=?,last_error=NULL WHERE provider=?",
          ).run(now(), p);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      } catch (error) {
        const msg =
          error instanceof IntegrationError
            ? error.safeMessage
            : "Import failed. Previously saved data is preserved. Check the connection and retry.";
        db.prepare(
          "UPDATE sync_runs SET status='failed',finished_at=?,error=? WHERE id=?",
        ).run(now(), msg, job);
        db.prepare("UPDATE integrations SET last_error=? WHERE provider=?").run(
          msg,
          p,
        );
      } finally {
        busy.delete(scope);
      }
    });
    tasks.add(task);
    task.finally(() => tasks.delete(task));
    res.status(202).json({ id: job, windowDays: 90 });
  });
  app.get("/api/beta/syncs", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 100")
        .all(),
    ),
  );
  app.get("/api/beta/evidence", (req, res) => {
    let rows = evidence();
    if (req.query.kind) rows = rows.filter((r) => r.kind === req.query.kind);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      rows = rows.filter((r) =>
        (r.title + " " + JSON.stringify(r.data)).toLowerCase().includes(q),
      );
    }
    res.json(rows);
  });
  app.post("/api/beta/article", async (req, res) => {
    const v = z.object({ url: z.string().url().max(2000) }).parse(req.body),
      r = await importArticle(v.url),
      id = uid();
    db.prepare(
      "INSERT INTO evidence VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider,kind,external_id) DO UPDATE SET data=excluded.data,title=excluded.title",
    ).run(
      id,
      "article",
      r.url,
      "resource",
      now(),
      r.title,
      JSON.stringify({
        body: r.text,
        sourceUrl: r.url,
        extraction:
          "Accessible page text. Source claims are not independently verified.",
      }),
    );
    res.status(201).json({ ok: true });
  });
  app.get("/api/beta/evidence/:id", (req, res) =>
    res.json(parse(find("evidence", req.params.id))),
  );
  app.post("/api/beta/evidence", (req, res) => {
    const v = z
        .object({
          kind: z.enum(["call", "resource", "message"]),
          title: short,
          text: z.string().min(1).max(90000),
          stage: z.enum(["setting", "closing", "resource"]).default("resource"),
          sourceUrl: z.string().max(2000).default(""),
          occurredAt: z.string().optional(),
        })
        .parse(req.body),
      id = uid();
    if (v.sourceUrl && !/^https:\/\//.test(v.sourceUrl))
      throw new IntegrationError("Use an HTTPS source URL.", 400);
    db.prepare("INSERT INTO evidence VALUES (?,?,?,?,?,?,?)").run(
      id,
      "upload",
      id,
      v.kind,
      v.occurredAt || now(),
      v.title,
      JSON.stringify({
        body: v.text,
        transcript: v.kind === "call" ? v.text : undefined,
        stage: v.stage,
        sourceUrl: v.sourceUrl,
        transcriptStatus: v.kind === "call" ? "uploaded" : undefined,
      }),
    );
    audit(req, "evidence.uploaded", id);
    res.status(201).json(getEvidence(id));
  });
  app.get("/api/beta/analytics", (req, res) => {
    const from = req.query.from
        ? date.parse(req.query.from)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      to = req.query.to ? date.parse(req.query.to) : now().slice(0, 10);
    const all = evidence(),
      rows = all.filter(
        (r) =>
          !r.occurred_at ||
          (r.occurred_at.slice(0, 10) >= from &&
            r.occurred_at.slice(0, 10) <= to),
      );
    const outcomes = Object.fromEntries(
      db
        .prepare("SELECT * FROM outcome_records")
        .all()
        .map((r) => [r.evidence_id, JSON.parse(r.data)]),
    );
    res.json({
      ...performance(
        rows,
        db.prepare("SELECT * FROM revenue_links").all(),
        outcomes,
      ),
      from,
      to,
      ads: rows.filter((r) => r.kind === "ad_day"),
      creatives: all.filter((r) => r.kind === "owned_ad"),
      videos: all.filter((r) => r.kind === "video"),
      payments: rows.filter((r) => r.kind === "payment"),
      opportunities: all.filter((r) => r.kind === "opportunity"),
      outcomes,
      links: db.prepare("SELECT * FROM revenue_links").all(),
    });
  });
  app.put("/api/beta/outcomes/:id", (req, res) => {
    const row = find("evidence", req.params.id);
    if (row.kind !== "opportunity")
      throw new IntegrationError("Select a CRM opportunity.", 400);
    const v = z
      .object({
        callOutcome: z.enum([
          "Unknown",
          "Attended",
          "No-show",
          "Cancelled",
          "Rescheduled",
        ]),
        salesOutcome: z.enum([
          "Unknown",
          "Follow-up needed",
          "Won",
          "Lost",
          "Abandoned",
        ]),
        objection: z.string().max(500),
        lossReason: z.string().max(2000),
        contractValue: z.number().nonnegative().nullable(),
        currency: z.string().max(8),
        nextAction: z.string().max(2000),
        followUpDate: z.string().max(30),
      })
      .parse(req.body);
    if (v.salesOutcome === "Lost" && !v.lossReason.trim())
      throw new IntegrationError(
        "Record a loss reason, or explicitly use Unknown.",
        400,
      );
    db.prepare(
      "INSERT INTO outcome_records VALUES (?,?,?) ON CONFLICT(evidence_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
    ).run(row.id, JSON.stringify(v), now());
    audit(req, "outcome.recorded", row.id);
    res.json(v);
  });
  app.post("/api/beta/revenue-links", (req, res) => {
    const v = z
      .object({ paymentId: short, opportunityId: short })
      .parse(req.body);
    if (
      find("evidence", v.paymentId).kind !== "payment" ||
      find("evidence", v.opportunityId).kind !== "opportunity"
    )
      throw new IntegrationError("Choose a payment and CRM opportunity.", 400);
    db.prepare(
      "INSERT INTO revenue_links VALUES (?,?,?) ON CONFLICT(payment_id) DO UPDATE SET opportunity_id=excluded.opportunity_id",
    ).run(v.paymentId, v.opportunityId, now());
    audit(req, "payment.linked", v.paymentId);
    res.json({ ok: true });
  });
  app.get("/api/beta/objections", (req, res) => {
    const calls = evidence().filter((r) => r.kind === "call");
    const candidates = objectionCandidates(calls);
    const entries = db.prepare("SELECT * FROM objection_entries").all();
    res.json({
      candidates,
      entries,
      boards: db.prepare("SELECT * FROM objection_boards").all(),
      themes: Object.keys(Object.groupBy(candidates, (x) => x.theme)).map(
        (theme) => ({
          theme,
          callCount: new Set(
            candidates
              .filter((x) => x.theme === theme)
              .map((x) => x.evidenceId),
          ).size,
          confirmed: entries.filter((x) => x.theme === theme && x.confirmed)
            .length,
        }),
      ),
      note: "Frequency counts distinct calls, not verified causes of lost sales. Keyword suggestions require speaker and context review.",
    });
  });
  app.post("/api/beta/objection-boards", (req, res) => {
    const v = z
        .object({ name: short, notes: z.string().max(5000).default("") })
        .parse(req.body),
      id = uid();
    db.prepare("INSERT INTO objection_boards VALUES (?,?,?)").run(
      id,
      v.name,
      v.notes,
    );
    res.status(201).json({ id, ...v });
  });
  app.post("/api/beta/objections", (req, res) => {
    const v = z
      .object({
        boardId: short,
        evidenceId: short,
        theme: short,
        excerpt: z.string().min(1).max(3000),
        confirmed: z.boolean().default(false),
        notes: z.string().max(5000).default(""),
      })
      .parse(req.body);
    find("objection_boards", v.boardId);
    const source = parse(find("evidence", v.evidenceId));
    if (!(source.data.transcript || source.data.body || "").includes(v.excerpt))
      throw new IntegrationError(
        "An evidence excerpt must appear verbatim in the source.",
        400,
      );
    const id = uid();
    db.prepare(
      "INSERT INTO objection_entries VALUES (?,?,?,?,?,?,?) ON CONFLICT(board_id,evidence_id,theme) DO UPDATE SET excerpt=excluded.excerpt,confirmed=excluded.confirmed,notes=excluded.notes",
    ).run(
      id,
      v.boardId,
      v.evidenceId,
      v.theme,
      v.excerpt,
      Number(v.confirmed),
      v.notes,
    );
    res.json({ ok: true });
  });
  app.get("/api/beta/competitor-references", (req, res) =>
    res.json(
      db
        .prepare("SELECT id,data FROM items ORDER BY last_seen DESC LIMIT 200")
        .all()
        .map((r) => ({ id: r.id, ...JSON.parse(r.data) })),
    ),
  );
  app.post("/api/beta/competitor-references/:id", (req, res) => {
    const r = find("items", req.params.id),
      d = JSON.parse(r.data),
      id = uid();
    db.prepare(
      "INSERT INTO evidence VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider,kind,external_id) DO UPDATE SET title=excluded.title,data=excluded.data",
    ).run(
      id,
      "research",
      r.id,
      "resource",
      r.last_seen,
      d.title || "Competitor reference",
      JSON.stringify({
        body: d.caption || "",
        transcript: d.transcript || "",
        sourceUrl: d.sourceUrl,
        origin:
          "Competitor research; public engagement is not sales performance.",
      }),
    );
    res.json({ ok: true });
  });
  app.get("/api/beta/campaigns", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM campaigns ORDER BY updated_at DESC")
        .all()
        .map(parse),
    ),
  );
  app.post("/api/beta/campaigns", async (req, res) => {
    const v = z
      .object({
        title: short,
        boardId: short,
        framework: z.enum(Object.keys(frameworks)),
        formats: z
          .array(
            z.enum(["email", "sms", "video", "paid_ad", "carousel", "nurture"]),
          )
          .min(1),
        cta: z
          .object({ text: z.string().max(2000), override: z.boolean() })
          .default({ text: "", override: false }),
        manual: z.boolean().default(false),
        sourceIds: z.array(short).max(30).default([]),
      })
      .parse(req.body);
    find("objection_boards", v.boardId);
    const entries = db
      .prepare(
        "SELECT * FROM objection_entries WHERE board_id=? AND confirmed=1",
      )
      .all(v.boardId);
    const refs = entries.map((e) => ({
      ...getEvidence(e.evidence_id),
      excerpt: e.excerpt,
    }));
    for (const sourceId of v.sourceIds) {
      const r = parse(find("evidence", sourceId));
      if (!refs.some((x) => x.id === r.id)) refs.push(r);
    }
    const data = v.manual
      ? {
          summary: "Manual draft",
          sourceEvidence: refs.map((r) => ({ id: r.id, reason: r.excerpt })),
          originalAdaptation: { angle: "", sequence: [] },
          proofNeeded: [],
          sourceIds: refs.map((r) => r.id),
          framework: v.framework,
        }
      : await (options.draftCampaign || draftCampaign)({
          ...v,
          offer: {
            ...getSetting("offer"),
            voice: getSetting("brand").voice || getSetting("offer").voice,
            brandNotes: getSetting("brand").notes,
          },
          evidence: refs,
        });
    const id = uid(),
      time = now();
    db.prepare(
      "INSERT INTO campaigns(id,title,board_id,data,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    ).run(id, v.title, v.boardId, JSON.stringify(data), time, time);
    db.prepare("INSERT INTO campaign_versions VALUES (?,?,?,?)").run(
      id,
      1,
      JSON.stringify(data),
      time,
    );
    audit(req, "campaign.created", id);
    res.status(201).json(parse(find("campaigns", id)));
  });
  app.patch("/api/beta/campaigns/:id", (req, res) => {
    const v = z
        .object({
          revision: z.number().int(),
          title: short,
          data: z.object({
            summary: z.string().max(20000),
            sourceEvidence: z.array(
              z.object({ id: short, reason: z.string().max(10000) }),
            ),
            originalAdaptation: z.record(z.string(), z.unknown()),
            proofNeeded: z.array(z.string().max(2000)),
            sourceIds: z.array(short).optional(),
            framework: z.string().optional(),
          }),
        })
        .parse(req.body),
      r = find("campaigns", req.params.id);
    if (r.revision !== v.revision)
      throw new IntegrationError(
        "Another edit was saved. Reload before editing.",
        409,
      );
    for (const source of v.data.sourceEvidence) find("evidence", source.id);
    db.prepare(
      "UPDATE campaigns SET title=?,data=?,revision=revision+1,stage='Draft',approved_revision=NULL,updated_at=? WHERE id=?",
    ).run(v.title, JSON.stringify(v.data), now(), r.id);
    db.prepare("INSERT INTO campaign_versions VALUES (?,?,?,?)").run(
      r.id,
      r.revision + 1,
      JSON.stringify(v.data),
      now(),
    );
    audit(req, "campaign.edited", r.id);
    res.json(parse(find("campaigns", r.id)));
  });
  app.get("/api/beta/assets", (req, res) =>
    res.json(assets().filter((a) => a.mime.startsWith("image/"))),
  );
  app.post(
    "/api/beta/assets",
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "20mb",
    }),
    (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length < 16)
        throw new IntegrationError(
          "Upload a JPEG, PNG or WebP photo up to 20 MB.",
          400,
        );
      const mime = body.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? "image/jpeg"
        : body
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? "image/png"
          : body.toString("ascii", 0, 4) === "RIFF" &&
              body.toString("ascii", 8, 12) === "WEBP"
            ? "image/webp"
            : null;
      if (!mime) throw new IntegrationError("Unsupported image content.", 400);
      const sha = createHash("sha256").update(body).digest("hex"),
        prior = db.prepare("SELECT * FROM assets WHERE sha256=?").get(sha);
      if (prior) return res.json(prior);
      const id = uid(),
        name = String(req.get("X-File-Name") || "Photo").slice(0, 200);
      mkdirSync(assetDir(req.workspaceId), { recursive: true, mode: 0o700 });
      writeFileSync(join(assetDir(req.workspaceId), id), body, {
        mode: 0o600,
        flag: "wx",
      });
      db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?)").run(
        id,
        name,
        mime,
        sha,
        body.length,
        now(),
      );
      res.status(201).json(find("assets", id));
    },
  );
  app.get("/api/beta/assets/:id", (req, res) => {
    const a = find("assets", req.params.id);
    res.type(a.mime).send(readAsset(req.workspaceId, a.id));
  });
  app.post(
    "/api/beta/media",
    express.raw({
      type: ["video/mp4", "video/webm", "audio/mpeg", "audio/wav", "audio/mp4"],
      limit: "24mb",
    }),
    async (req, res) => {
      if (req.get("X-Transcription-Consent") !== "true")
        throw new IntegrationError(
          "Confirm that this recording may be sent to OpenAI for transcription.",
          400,
        );
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new IntegrationError(
          "Upload a supported audio/video file up to 24 MB.",
          400,
        );
      const mime = req.get("Content-Type").split(";")[0],
        sha = createHash("sha256").update(req.body).digest("hex"),
        name = String(req.get("X-File-Name") || "Uploaded recording").slice(
          0,
          200,
        );
      let asset = db.prepare("SELECT * FROM assets WHERE sha256=?").get(sha);
      if (!asset) {
        const aid = uid();
        mkdirSync(assetDir(req.workspaceId), { recursive: true, mode: 0o700 });
        writeFileSync(join(assetDir(req.workspaceId), aid), req.body, {
          mode: 0o600,
          flag: "wx",
        });
        db.prepare("INSERT INTO assets VALUES (?,?,?,?,?,?)").run(
          aid,
          name,
          mime,
          sha,
          req.body.length,
          now(),
        );
        asset = find("assets", aid);
      }
      let result, warning;
      try {
        result = await (options.transcribeMedia || transcribeMedia)(
          req.body,
          mime,
        );
      } catch (e) {
        warning =
          e.safeMessage ||
          "Transcript unavailable. Original media is preserved.";
      }
      const prior = db
        .prepare(
          "SELECT data FROM evidence WHERE provider='upload' AND kind='resource' AND external_id=?",
        )
        .get(asset.id);
      const previous = prior ? JSON.parse(prior.data) : {};
      if (!result && previous.transcript)
        result = {
          transcript: previous.transcript,
          segments: previous.segments,
          duration: previous.duration,
          retained: true,
        };
      const id = uid(),
        data = {
          assetId: asset.id,
          stage: "resource",
          body: result?.transcript || "",
          transcript: result?.transcript || "",
          segments: result?.segments || [],
          duration: result?.duration,
          transcriptStatus: result?.retained
            ? "retained from previous import"
            : result
              ? "auto-transcribed"
              : "unavailable",
          extraction:
            "Audio transcript only; visual content has not been reviewed.",
          warning,
        };
      db.prepare(
        "INSERT INTO evidence VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider,kind,external_id) DO UPDATE SET data=excluded.data",
      ).run(
        id,
        "upload",
        asset.id,
        "resource",
        now(),
        name,
        JSON.stringify(data),
      );
      res.status(201).json({ ok: true, warning });
    },
  );
  app.get("/api/beta/carousels", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM carousels ORDER BY updated_at DESC")
        .all()
        .map(parse),
    ),
  );
  app.post("/api/beta/carousels", (req, res) => {
    const v = z
        .object({
          title: short,
          style: z.enum(["photo", "brand"]),
          campaignId: z.string().optional(),
        })
        .parse(req.body),
      brand = getSetting("brand");
    let sourceIds = [],
      slides,
      caption = "";
    if (v.campaignId) {
      const c = parse(find("campaigns", v.campaignId));
      sourceIds = c.data.sourceEvidence.map((x) => x.id);
      const asset = c.data.originalAdaptation.sequence?.find(
        (a) => a.format === "carousel",
      );
      caption = asset?.caption || asset?.fullCopy || "";
      slides = asset?.shotList || [];
      if (typeof slides === "string")
        slides = slides.split("\n").filter(Boolean);
      if (!Array.isArray(slides)) slides = [];
      slides = slides.map((s, i) => ({
        id: uid(),
        heading:
          typeof s === "string" ? s : String(s.heading || `Slide ${i + 1}`),
        body: typeof s === "object" ? String(s.body || "") : "",
        takeaway: typeof s === "object" ? String(s.takeaway || "") : "",
        photos: [],
        layout: "single",
        position: "left",
      }));
    }
    if (!slides?.length)
      slides = [
        {
          id: uid(),
          heading: v.title,
          body: "",
          takeaway: "",
          photos: [],
          layout: "single",
          position: "left",
        },
        {
          id: uid(),
          heading: "Your next step",
          body: "",
          takeaway: getSetting("offer").cta || "",
          photos: [],
          layout: "single",
          position: "left",
        },
      ];
    const data = {
        ...brand,
        style: v.style,
        slides,
        sourceIds,
        caption,
        handle: "",
      },
      id = uid();
    db.prepare(
      "INSERT INTO carousels(id,title,data,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run(id, v.title, JSON.stringify(data), now(), now());
    res.status(201).json(parse(find("carousels", id)));
  });
  app.patch("/api/beta/carousels/:id", (req, res) => {
    const v = z
        .object({
          revision: z.number().int(),
          title: short,
          data: z.object({
            style: z.enum(["photo", "brand"]),
            slides: z
              .array(
                z.object({
                  id: short,
                  heading: z.string().max(180),
                  body: z.string().max(900),
                  takeaway: z.string().max(250),
                  photos: z.array(short).max(4),
                  layout: z.enum(["single", "collage"]),
                  position: z.enum(["left", "right"]),
                  cropX: z.number().min(0).max(100).optional(),
                  cropY: z.number().min(0).max(100).optional(),
                }),
              )
              .min(2)
              .max(20),
            caption: z.string().max(10000),
            handle: z.string().max(100),
            background: z.string().optional(),
            ink: z.string().optional(),
            accent: z.string().optional(),
            font: z.string().optional(),
            logoId: z.string().optional(),
            sourceIds: z.array(short).default([]),
          }),
        })
        .parse(req.body),
      r = find("carousels", req.params.id);
    if (r.revision !== v.revision)
      throw new IntegrationError("Another edit was saved. Reload first.", 409);
    for (const id of v.data.sourceIds) find("evidence", id);
    for (const s of v.data.slides)
      for (const id of s.photos) find("assets", id);
    db.prepare(
      "UPDATE carousels SET data=?,title=?,revision=revision+1,stage='Draft',approved_revision=NULL,updated_at=? WHERE id=?",
    ).run(JSON.stringify(v.data), v.title, now(), r.id);
    audit(req, "carousel.edited", r.id);
    res.json(parse(find("carousels", r.id)));
  });
  app.get("/api/beta/carousels/:id/preview", (req, res) => {
    const c = parse(find("carousels", req.params.id));
    const slides =
      req.query.slide === undefined
        ? c.data.slides
        : [
            c.data.slides[
              z.coerce
                .number()
                .int()
                .min(0)
                .max(c.data.slides.length - 1)
                .parse(req.query.slide)
            ],
          ];
    res.json({
      slides: slides.map((s) =>
        slideHtml(s, c.data, assets(), (id) => readAsset(req.workspaceId, id)),
      ),
    });
  });
  app.post("/api/beta/carousels/:id/export", async (req, res) => {
    const c = parse(find("carousels", req.params.id));
    try {
      const files = await renderCarousel(c.data, assets(), (id) =>
        readAsset(req.workspaceId, id),
      );
      res
        .set(
          "Content-Disposition",
          `attachment; filename="carousel-${c.id}.zip"`,
        )
        .type("application/zip")
        .send(zip(files));
      audit(req, "carousel.exported", c.id);
    } catch (e) {
      if (e.code === "RENDER_BUSY") throw new IntegrationError(e.message, 429);
      throw new IntegrationError(
        e.message?.startsWith("Slide") || e.message?.includes("photo")
          ? e.message
          : "Export failed. Check photo assignments, shorten dense slides, and confirm the renderer is installed.",
        400,
      );
    }
  });
  for (const type of ["campaigns", "carousels"])
    app.post(`/api/beta/${type}/:id/stage`, (req, res) => {
      const v = z
          .object({ stage: z.enum(stages), revision: z.number().int() })
          .parse(req.body),
        r = find(type, req.params.id);
      if (v.revision !== r.revision)
        throw new IntegrationError(
          "The draft changed. Reload before approval.",
          409,
        );
      if (
        !["Draft", "In review"].includes(v.stage) &&
        req.user.role !== "owner"
      )
        return res.status(403).json({
          error: "Only the Levr owner can approve or advance production.",
        });
      if (
        ["In production", "Live", "Reviewed"].includes(v.stage) &&
        r.approved_revision !== r.revision
      )
        throw new IntegrationError("Approve the current revision first.", 400);
      if (v.stage === "Approved") {
        if (type === "carousels") {
          try {
            validateCarousel(JSON.parse(r.data), assets());
          } catch (e) {
            throw new IntegrationError(e.message, 400);
          }
        } else {
          const d = JSON.parse(r.data);
          if (d.proofNeeded?.length)
            throw new IntegrationError(
              "Resolve the proof-needed list before approval.",
              400,
            );
          if (!d.originalAdaptation?.sequence?.length)
            throw new IntegrationError(
              "Add campaign assets before approval.",
              400,
            );
        }
      }
      db.prepare(
        `UPDATE ${type} SET stage=?,approved_revision=?,updated_at=? WHERE id=?`,
      ).run(
        v.stage,
        v.stage === "Approved"
          ? r.revision
          : ["Draft", "In review"].includes(v.stage)
            ? null
            : r.approved_revision,
        now(),
        r.id,
      );
      audit(req, `${type}.${v.stage}`, r.id);
      res.json(parse(find(type, r.id)));
    });
  app.get("/api/beta/comments", (req, res) => {
    const type = z.enum(["campaigns", "carousels"]).parse(req.query.type);
    find(type, String(req.query.id));
    res.json(
      db
        .prepare(
          "SELECT * FROM comments WHERE target_type=? AND target_id=? ORDER BY created_at",
        )
        .all(type, String(req.query.id)),
    );
  });
  app.post("/api/beta/comments", (req, res) => {
    const v = z
      .object({
        type: z.enum(["campaigns", "carousels"]),
        targetId: short,
        slideId: z.string().max(100).optional(),
        body: z.string().trim().min(1).max(5000),
      })
      .parse(req.body);
    find(v.type, v.targetId);
    const id = uid();
    db.prepare("INSERT INTO comments VALUES (?,?,?,?,?,?,?)").run(
      id,
      v.type,
      v.targetId,
      v.slideId || null,
      req.user.email,
      v.body,
      now(),
    );
    res.status(201).json({ id, ...v });
  });
  app.post("/api/beta/ask", async (req, res) => {
    const v = z
      .object({ question: z.string().trim().min(3).max(4000) })
      .parse(req.body);
    res.json(await answerEvidence(v.question, evidence()));
  });
  app.get("/api/beta/audit", own, (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200",
        )
        .all(),
    ),
  );
  app.use("/api/beta", (err, req, res, next) => {
    if (err instanceof IntegrationError)
      return res.status(err.status).json({ error: err.safeMessage });
    next(err);
  });
  return { wait: () => Promise.all([...tasks]) };
}
