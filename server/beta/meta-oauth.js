import { randomBytes, createHash } from "node:crypto";
import { verifyConnection } from "./providers.js";
const digest = (s) => createHash("sha256").update(s).digest("hex");
export function registerMetaOAuth(
  app,
  { catalog, manager, vault, options = {} },
) {
  const pending = new Map(),
    fetchImpl = options.fetchImpl || fetch;
  const settings = () => ({
    id: process.env.META_APP_ID,
    secret: process.env.META_APP_SECRET,
    origin: process.env.PUBLIC_BASE_URL,
  });
  app.post("/api/beta/meta/oauth/start", (req, res) => {
    if (req.user.role !== "owner")
      return res
        .status(403)
        .json({ error: "Levr manages the Meta business connection." });
    const cfg = settings();
    if (!cfg.id || !cfg.secret || !cfg.origin)
      return res.status(503).json({
        error:
          "Set META_APP_ID, META_APP_SECRET and PUBLIC_BASE_URL in the paid beta’s secure hosting settings first.",
      });
    if (!/^https:\/\/[^/]+\/?$/.test(cfg.origin))
      return res
        .status(503)
        .json({ error: "PUBLIC_BASE_URL must be this beta’s HTTPS origin." });
    const accountId = String(req.body?.accountId || "").replace(/^act_/, "");
    if (!/^\d+$/.test(accountId))
      return res
        .status(400)
        .json({ error: "Enter the numeric client ad account ID." });
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    const state = randomBytes(32).toString("base64url");
    pending.set(digest(state), {
      workspace: req.workspaceId,
      connection: req.workspaceDatabase,
      sessionHash: req.session.token_hash,
      accountId,
      expires: Date.now() + 600000,
    });
    const u = new URL(
      `https://www.facebook.com/${process.env.META_API_VERSION || "v23.0"}/dialog/oauth`,
    );
    u.searchParams.set("client_id", cfg.id);
    u.searchParams.set(
      "redirect_uri",
      cfg.origin.replace(/\/$/, "") + "/oauth/meta/callback",
    );
    u.searchParams.set("scope", "ads_read");
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    res.json({ url: u.href });
  });
  app.get("/oauth/meta/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "",
      entry = pending.get(digest(state));
    pending.delete(digest(state));
    if (
      !entry ||
      entry.expires < Date.now() ||
      !catalog
        .prepare(
          "SELECT 1 FROM sessions WHERE token_hash=? AND user_id IS NULL AND expires_at>?",
        )
        .get(entry.sessionHash, Date.now())
    )
      return res
        .status(400)
        .type("text")
        .send("This connection link expired. Sign in and start again.");
    if (typeof req.query.code !== "string" || req.query.error)
      return res.redirect("/connections?meta=cancelled");
    const cfg = settings(),
      root = `https://graph.facebook.com/${process.env.META_API_VERSION || "v23.0"}/oauth/access_token`;
    const exchange = async (fields) => {
      const r = await fetchImpl(root, {
        method: "POST",
        body: new URLSearchParams(fields),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Meta token exchange failed");
      const d = await r.json();
      if (typeof d.access_token !== "string") throw Error("Meta token missing");
      return d.access_token;
    };
    try {
      let key = await exchange({
        client_id: cfg.id,
        client_secret: cfg.secret,
        redirect_uri: cfg.origin.replace(/\/$/, "") + "/oauth/meta/callback",
        code: req.query.code,
      });
      key = await exchange({
        grant_type: "fb_exchange_token",
        client_id: cfg.id,
        client_secret: cfg.secret,
        fb_exchange_token: key,
      });
      await (options.verifyConnection || verifyConnection)(
        "meta",
        key,
        entry.accountId,
      );
      catalog.exec(
        "CREATE TABLE IF NOT EXISTS beta_account_bindings(provider TEXT,account_id TEXT,workspace_id TEXT,PRIMARY KEY(provider,account_id))",
      );
      const bindingId = `act_${entry.accountId}`,
        prior = catalog
          .prepare(
            "SELECT workspace_id FROM beta_account_bindings WHERE provider=? AND account_id=?",
          )
          .get("meta", bindingId);
      if (prior && prior.workspace_id !== entry.workspace)
        throw Error("Account already assigned");
      vault.set(entry.workspace, key, { verifiedAt: new Date().toISOString() });
      catalog
        .prepare("INSERT OR IGNORE INTO beta_account_bindings VALUES (?,?,?)")
        .run("meta", bindingId, entry.workspace);
      const date = new Date().toISOString();
      entry.connection
        .prepare(
          "INSERT INTO integrations(provider,account_id,connected_at) VALUES (?,?,?) ON CONFLICT(provider) DO UPDATE SET account_id=excluded.account_id,connected_at=excluded.connected_at,last_error=NULL",
        )
        .run("meta", entry.accountId, date);
      res.redirect(
        `/connections?meta=connected&workspace=${encodeURIComponent(entry.workspace)}`,
      );
    } catch {
      res.redirect("/connections?meta=failed");
    }
  });
}
