import React, { useState, useEffect, useRef } from "react";
import "./beta.css";
const labels = {
  launch: "Getting started",
  performance: "Ad performance",
  connections: "Connections",
  evidence: "Evidence library",
  objections: "Objection Lab",
  campaigns: "Campaign briefs",
  studio: "Carousel Studio",
  outcomes: "Sales outcomes",
  intelligence: "Ask intelligence",
};
export const betaNav = Object.entries(labels);
function useData(api, path, version = 0) {
  const [state, set] = useState({ data: null, error: "", loading: true });
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true, error: "" }));
    api(path)
      .then((data) => alive && set({ data, error: "", loading: false }))
      .catch(
        (e) =>
          alive && set((s) => ({ ...s, error: e.message, loading: false })),
      );
    return () => {
      alive = false;
    };
  }, [path, version]);
  return state;
}
const fmt = (n) =>
  n == null
    ? "Unavailable"
    : Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(n);
const json = (v) => JSON.stringify(v, null, 2);
const fieldLabel = (key) =>
  ({
    cta: "Call to action",
    fullCopy: "Full copy / spoken script",
    proofPlan: "Proof plan",
    shotList: "Shot list or slide outline",
    deliveryTrigger: "Delivery trigger",
    qualityChecks: "Quality review",
  })[key] ||
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const fileName = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
function Link({ url, children = "Open source" }) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return (
      <a href={u.href} target="_blank" rel="noopener noreferrer">
        {children} ↗
      </a>
    );
  } catch {
    return null;
  }
}
function Field({ label, children }) {
  return (
    <label className="field">
      {label}
      {React.isValidElement(children)
        ? React.cloneElement(children, { "aria-label": label })
        : children}
    </label>
  );
}
function ErrorView({ error }) {
  return error ? (
    <p role="alert" className="error-banner">
      {error}
    </p>
  ) : null;
}
function Empty({ children }) {
  return <div className="empty-state">{children}</div>;
}
function Button({ children, ...p }) {
  return (
    <button className="button" {...p}>
      {children}
    </button>
  );
}
function Panel({ title, children }) {
  return (
    <section className="card beta-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Source({ record, api }) {
  return (
    <details className="source-record" id={`evidence-${record.id}`}>
      <summary>
        {record.title}{" "}
        <small>
          {record.provider} · {record.kind} ·{" "}
          {record.occurred_at?.slice(0, 10) || "Date unavailable"}
        </small>
      </summary>
      <Link url={record.data.sourceUrl} />
      {record.data.transcriptStatus && (
        <p className="caption">Transcript: {record.data.transcriptStatus}</p>
      )}
      {record.data.warning && <p className="notice">{record.data.warning}</p>}
      <pre>
        {record.data.transcript || record.data.body || json(record.data)}
      </pre>
      {record.data.extraction && (
        <p className="caption">{record.data.extraction}</p>
      )}
      {record.data.assetId && api && (
        <MediaPlayer api={api} assetId={record.data.assetId} />
      )}
      {record.kind === "call" && !record.data.transcript && (
        <p>Transcript unavailable. This call remains in the library.</p>
      )}
    </details>
  );
}
export default function Beta({
  page,
  api,
  version,
  changed,
  notify,
  workspace,
  owner,
  go,
  researchSetup,
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      changed();
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const props = {
    api,
    version,
    changed,
    notify,
    workspace,
    owner,
    go,
    researchSetup,
    act,
    busy,
  };
  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">Levr Intelligence · Private beta</div>
          <h1 className="page-title">{labels[page]}.</h1>
          <p className="page-description">
            {workspace.name} · One core offer · Manual imports · Owner approval
          </p>
        </div>
      </header>
      <ErrorView error={error} />
      {busy && (
        <p role="status" className="notice">
          Working… Your saved work remains available.
        </p>
      )}
      {page === "launch" ? (
        <Onboarding {...props} />
      ) : page === "connections" ? (
        <Connections {...props} />
      ) : page === "performance" ? (
        <Performance {...props} />
      ) : page === "evidence" ? (
        <Evidence {...props} />
      ) : page === "objections" ? (
        <Objections {...props} />
      ) : page === "campaigns" ? (
        <Campaigns {...props} />
      ) : page === "studio" ? (
        <Studio {...props} />
      ) : page === "outcomes" ? (
        <Outcomes {...props} />
      ) : page === "intelligence" ? (
        <AskIntelligence {...props} />
      ) : null}
    </>
  );
}
function Onboarding({ api, version, act, busy, go, researchSetup }) {
  const status = useData(api, "/api/beta/status", version);
  const [offer, setOffer] = useState(null),
    [brand, setBrand] = useState(null),
    [pasted, setPasted] = useState("");
  useEffect(() => {
    if (status.data) {
      setOffer(
        (s) =>
          s || {
            name: "",
            audience: "",
            promise: "",
            price: "",
            proof: "",
            salesProcess: "",
            voice: "",
            website: "",
            cta: "",
            ...status.data.offer,
          },
      );
      setBrand(
        (s) =>
          s || {
            name: "",
            background: "#fbfaf8",
            ink: "#121212",
            accent: "#b4442e",
            font: "Inter Tight",
            voice: "",
            notes: "",
            logoId: "",
            ...status.data.brand,
          },
      );
    }
  }, [status.data]);
  const assets = useData(api, "/api/beta/assets", version);
  if (!offer || !brand)
    return (
      <>
        <ErrorView error={status.error} />
        <p>Loading onboarding…</p>
      </>
    );
  const prompt = `Help me assemble a practical brand kit for ${offer.name || "my business"}. Ask one question at a time. My audience: ${offer.audience}. Core offer: ${offer.promise}. Website: ${offer.website}. Use my supplied posts, emails and voice samples. Separate existing brand choices from suggestions. Never invent results, testimonials or proof. Return JSON with name, background (#RRGGBB), ink (#RRGGBB), accent (#RRGGBB), font (Inter Tight, Arial, Georgia, or Times New Roman), voice, and notes. Suggest readable colours and explain them. Do not include private prospect or payment data.`;
  return (
    <>
      <div className="beta-steps">
        <span>01 Offer</span>
        <span>02 Brand & photos</span>
        <span>03 Connections</span>
        <span>04 Import 90 days</span>
      </div>
      <div className="beta-grid">
        <Panel title="Your core offer">
          <p>
            One offer keeps reporting and briefs focused. You can update these
            details anytime.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api("/api/beta/profile/offer", { method: "PUT", body: offer }),
              );
            }}
          >
            {Object.entries({
              name: "Offer name",
              audience: "Who is it for?",
              promise: "What does it help them achieve?",
              price: "Price and payment terms",
              proof: "Approved proof, case studies and source links",
              salesProcess: "Sales process",
              voice: "Writing voice and examples",
              website: "Website",
              cta: "Approved call to action and destination",
            }).map(([key, label]) => (
              <Field key={key} label={label}>
                <textarea
                  value={offer[key]}
                  onChange={(e) =>
                    setOffer({ ...offer, [key]: e.target.value })
                  }
                  required={key === "name"}
                  rows={key === "proof" ? 4 : 2}
                />
              </Field>
            ))}
            <Button disabled={busy}>Save offer</Button>
          </form>
        </Panel>
        <Panel title="Build your brand kit">
          <p>
            Upload existing assets, or use this guided prompt in ChatGPT or
            Claude. Paste the prompt, attach your own posts or brand guide, then
            answer its questions. Review its suggestions before saving.
          </p>
          <textarea
            aria-label="Brand kit AI prompt"
            readOnly
            value={prompt}
            rows={7}
          />
          <Button
            onClick={() =>
              act(async () => {
                await navigator.clipboard.writeText(prompt);
              })
            }
          >
            Copy prompt
          </Button>
          <Field label="Upload a brand-kit JSON file">
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                act(async () => {
                  if (file.size > 200000)
                    throw Error(
                      "Use a brand-kit JSON file under 200 KB. Upload photos separately.",
                    );
                  setPasted(await file.text());
                });
                e.target.value = "";
              }}
            />
          </Field>
          <Field label="Paste the brand-kit JSON response">
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={5}
            />
          </Field>
          <Button
            onClick={() =>
              act(async () => {
                let value;
                try {
                  value = JSON.parse(pasted);
                } catch {
                  throw Error(
                    "Paste the JSON object from the response, without code fences.",
                  );
                }
                const next = { ...brand };
                for (const key of Object.keys(next))
                  if (typeof value[key] === "string") next[key] = value[key];
                setBrand(next);
              })
            }
          >
            Review extracted settings
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api("/api/beta/profile/brand", { method: "PUT", body: brand }),
              );
            }}
          >
            <Field label="Brand name">
              <input
                value={brand.name}
                onChange={(e) => setBrand({ ...brand, name: e.target.value })}
              />
            </Field>
            <div className="color-fields">
              {["background", "ink", "accent"].map((k) => (
                <Field key={k} label={k}>
                  <input
                    type="color"
                    value={brand[k]}
                    onChange={(e) =>
                      setBrand({ ...brand, [k]: e.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="Font">
              <select
                value={brand.font}
                onChange={(e) => setBrand({ ...brand, font: e.target.value })}
              >
                {["Inter Tight", "Arial", "Georgia", "Times New Roman"].map(
                  (f) => (
                    <option key={f}>{f}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Voice">
              <textarea
                value={brand.voice}
                onChange={(e) => setBrand({ ...brand, voice: e.target.value })}
              />
            </Field>
            <Field label="Brand notes / I don’t know yet">
              <textarea
                value={brand.notes}
                onChange={(e) => setBrand({ ...brand, notes: e.target.value })}
              />
            </Field>
            <Field label="Optional logo">
              <select
                value={brand.logoId || ""}
                onChange={(e) => setBrand({ ...brand, logoId: e.target.value })}
              >
                <option value="">No logo</option>
                {assets.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <div
              className="brand-sample"
              style={{
                background: brand.background,
                color: brand.ink,
                fontFamily: brand.font,
                borderBottom: `3px solid ${brand.accent}`,
              }}
            >
              <h3>Your next idea starts here.</h3>
              <p>
                Preview of your brand colours and type. Carousel Studio lets you
                preview both styles with your photos.
              </p>
            </div>
            <Button disabled={busy}>Save brand kit</Button>
          </form>
        </Panel>
      </div>
      <AssetLibrary api={api} version={version} act={act} busy={busy} />
      {researchSetup}
      <Panel title="Connect and import">
        <p>
          Connect each source, then manually import the last 90 days. Some
          historical recordings or workflow content may not be available. You
          can upload transcripts and existing sequences in Evidence.
        </p>
        <Button onClick={() => go("connections")}>Set up connections</Button>
      </Panel>
    </>
  );
}
const connectionHelp = {
  meta: {
    name: "Meta advertising",
    url: "https://developers.facebook.com/apps/",
    steps:
      "Levr creates a Meta developer app and requests ads_read access. Assign the client ad account in the Levr business. For this beta, use a read-only system-user access token assigned to that ad account. Enter the numeric ad account ID without act_. Business verification / app review may be required for client access.",
    field: "Meta ad account ID",
  },
  ghl: {
    name: "GoHighLevel",
    url: "https://app.gohighlevel.com",
    steps:
      "Open the client sub-account’s Settings → Private Integrations. Create a read-only integration for locations, opportunities, conversations and conversation messages. Copy its token and location ID. Enable call recording and transcription in the phone settings. Run an inbound and outbound test before relying on the import.",
    field: "Client location ID",
  },
  fathom: {
    name: "Fathom closing calls",
    url: "https://fathom.video",
    steps:
      "In the client’s own Fathom account, open API settings and create an API key. Availability depends on account access. Connect that key here. Only recordings and transcripts available to this account can be imported.",
    field: "Account label (optional)",
  },
  wistia: {
    name: "Wistia engagement",
    url: "https://my.wistia.com",
    steps:
      "Create an API token in your Wistia account with read access to the Data API and Stats API. Connect it here. Video engagement is attention data; it does not establish a sale or identify a CRM contact without separate tracking.",
    field: "Account label (optional)",
  },
  stripe: {
    name: "Stripe collected revenue",
    url: "https://dashboard.stripe.com/apikeys",
    steps:
      "Create a restricted live API key with read access to account and charges. Enter your Stripe account ID (acct_...) or leave it blank to verify the connected account. No charge, refund or customer mutations are performed. Payment-to-deal matching requires review.",
    field: "Stripe account ID (optional)",
  },
};
function Connections({ api, version, act, busy, owner, changed }) {
  const data = useData(api, "/api/beta/integrations", version),
    syncs = useData(api, "/api/beta/syncs", version);
  useEffect(() => {
    if (syncs.data?.some((s) => s.status === "running")) {
      const t = setInterval(changed, 2500);
      return () => clearInterval(t);
    }
  }, [syncs.data, changed]);
  return (
    <>
      {new URLSearchParams(location.search).get("meta") && (
        <p className="notice">
          {new URLSearchParams(location.search).get("meta") === "connected"
            ? "Meta connection saved for this workspace. You can import its last 90 days now."
            : "Meta sign-in was cancelled or failed. Check app approval, callback URL and assigned ad account, then retry."}
        </p>
      )}
      <p className="notice">
        Every source is read-only. Tokens are encrypted in this beta’s private
        storage. Imports happen only when you click Import 90 days.
      </p>
      <ErrorView error={data.error || syncs.error} />
      <div className="beta-grid">
        {data.data?.map((c) => {
          const h = connectionHelp[c.provider],
            disabled = c.agencyManaged && !owner;
          return (
            <Panel key={c.provider} title={h.name}>
              <span className="badge">
                {c.configured ? "Connected" : "Not connected"}
              </span>
              <p>{h.steps}</p>
              <Link url={h.url}>Open provider settings</Link>
              {c.provider === "meta" && owner && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const accountId = new FormData(e.currentTarget).get(
                      "metaAccount",
                    );
                    act(async () => {
                      const result = await api("/api/beta/meta/oauth/start", {
                        method: "POST",
                        body: { accountId },
                      });
                      location.assign(result.url);
                    });
                  }}
                >
                  <Field label="Ad account ID for Meta sign-in">
                    <input name="metaAccount" required />
                  </Field>
                  <Button disabled={busy || !c.oauthAvailable}>
                    Connect through Meta
                  </Button>
                  {!c.oauthAvailable && (
                    <p className="caption">
                      Levr must configure the Meta app credentials and callback
                      URL in the beta hosting settings to enable sign-in. A
                      restricted system-user token can also be connected below.
                    </p>
                  )}
                </form>
              )}
              {disabled ? (
                <p>Levr manages this agency connection.</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      body = {
                        apiKey: f.get("key"),
                        accountId: f.get("accountId"),
                      };
                    e.currentTarget.reset();
                    act(() =>
                      api(`/api/beta/integrations/${c.provider}`, {
                        method: "PUT",
                        body,
                      }),
                    );
                  }}
                >
                  <Field label={h.field}>
                    <input
                      name="accountId"
                      defaultValue={c.account_id || ""}
                      required={c.agencyManaged}
                    />
                  </Field>
                  <Field label="Secret API key or access token">
                    <input
                      type="password"
                      name="key"
                      autoComplete="off"
                      required
                      minLength={8}
                    />
                  </Field>
                  <Button disabled={busy}>Verify and connect</Button>
                </form>
              )}
              {c.configured && (
                <>
                  <p className="caption">
                    Account: {c.account_id}
                    <br />
                    Last successful import: {c.last_success || "Not yet"}
                  </p>
                  <ErrorView error={c.last_error} />
                  <div className="beta-actions">
                    <Button
                      disabled={
                        busy ||
                        syncs.data?.some(
                          (s) =>
                            s.provider === c.provider && s.status === "running",
                        )
                      }
                      onClick={() =>
                        act(() =>
                          api(`/api/beta/integrations/${c.provider}/sync`, {
                            method: "POST",
                          }),
                        )
                      }
                    >
                      Import 90 days
                    </Button>
                    {!disabled && (
                      <Button
                        onClick={() =>
                          act(() =>
                            api(`/api/beta/integrations/${c.provider}`, {
                              method: "DELETE",
                            }),
                          )
                        }
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Panel>
          );
        })}
      </div>
      <Panel title="Import history">
        {!syncs.data?.length ? (
          <Empty>No imports yet.</Empty>
        ) : (
          syncs.data.map((s) => (
            <div className="source-record" key={s.id}>
              <strong>
                {s.provider} · {s.status}
              </strong>
              <p>
                {s.started_at} · {s.record_count} records
              </p>
              {s.error && <p>{s.error}</p>}
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
function Performance({ api, version }) {
  const [from, setFrom] = useState(
      new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [currency, setCurrency] = useState(""),
    [campaign, setCampaign] = useState(""),
    [adset, setAdset] = useState("");
  const data = useData(
    api,
    `/api/beta/analytics?from=${from}&to=${to}`,
    version,
  );
  const d = data.data,
    metric =
      d?.currencies.find((x) => x.currency === currency) || d?.currencies[0];
  const ads =
    d?.ads.filter(
      (a) =>
        (!campaign || a.data.campaign_id === campaign) &&
        (!adset || a.data.adset_id === adset),
    ) || [];
  return (
    <>
      <div className="filters">
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Currency">
          <select
            value={metric?.currency || ""}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {d?.currencies.map((c) => (
              <option key={c.currency}>{c.currency}</option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorView error={data.error} />
      {!metric ? (
        <Empty>
          Connect Meta and Stripe, then import to see actual account
          performance.
        </Empty>
      ) : (
        <>
          <p>
            Currency: {metric.currency}. Account totals use the selected dates;
            campaign filters apply to the table below.
          </p>
          <div className="stat-grid">
            {[
              ["Spend", metric.spend],
              ["Meta ROAS", metric.metaRoas],
              ["Lead conversion %", metric.conversionRate],
              ["Net collected", metric.collected],
              ["Link CTR %", metric.ctr],
              ["Link CPC", metric.cpc],
              ["CPM", metric.cpm],
              ["Cost per lead", metric.cpl],
              ["Refunds", metric.refunds],
              ["CRM show rate %", d.showRate],
              ["CRM close rate %", d.closeRate],
              ["Missing outcomes", d.missingOutcomes],
            ].map(([label, v]) => (
              <div className="stat-card" key={label}>
                <span className="stat-label">{label}</span>
                <strong className="beta-number">{fmt(v)}</strong>
              </div>
            ))}
          </div>
          <p className="research-note">
            Lead conversion rate = reported leads ÷ landing-page views. Missing
            metrics remain unavailable. Reach and frequency are not summed
            across days. {d.attributionNote}
          </p>
        </>
      )}
      {d?.ads.length > 0 && (
        <SpendTrend rows={d.ads} currency={metric?.currency} />
      )}
      <Panel title="Ads by day">
        <div className="beta-actions">
          <Field label="Campaign">
            <select
              value={campaign}
              onChange={(e) => {
                setCampaign(e.target.value);
                setAdset("");
              }}
            >
              <option value="">All campaigns</option>
              {[
                ...new Map(
                  (d?.ads || []).map((a) => [
                    a.data.campaign_id,
                    a.data.campaign_name,
                  ]),
                ).entries(),
              ].map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ad set">
            <select value={adset} onChange={(e) => setAdset(e.target.value)}>
              <option value="">All ad sets</option>
              {[
                ...new Map(
                  (d?.ads || [])
                    .filter((a) => !campaign || a.data.campaign_id === campaign)
                    .map((a) => [a.data.adset_id, a.data.adset_name]),
                ).entries(),
              ].map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "Date",
                  "Ad",
                  "Campaign",
                  "Spend",
                  "Impressions",
                  "Link clicks",
                  "Leads",
                  "Revenue",
                  "Currency",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ads.map((a) => (
                <tr key={a.id}>
                  <td>{a.occurred_at}</td>
                  <td>{a.title}</td>
                  <td>{a.data.campaign_name}</td>
                  {[
                    "spend",
                    "impressions",
                    "linkClicks",
                    "leads",
                    "revenue",
                  ].map((k) => (
                    <td key={k}>{fmt(a.data[k])}</td>
                  ))}
                  <td>{a.data.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Owned ad creatives">
        {d?.creatives.length ? (
          d.creatives.map((a) => (
            <details className="source-record" key={a.id}>
              <summary>
                {a.title} · {a.data.effective_status}
              </summary>
              <Link url={a.data.sourceUrl} />
              {(a.data.creative?.image_url ||
                a.data.creative?.thumbnail_url) && (
                <img
                  className="owned-creative"
                  src={
                    a.data.creative.image_url || a.data.creative.thumbnail_url
                  }
                  alt={a.title}
                />
              )}
              <p>{a.data.creative?.body}</p>
              <p>{a.data.creative?.title}</p>
            </details>
          ))
        ) : (
          <Empty>No owned creatives imported.</Empty>
        )}
      </Panel>
      <Panel title="Wistia video engagement">
        {d?.videos.length ? (
          d.videos.map((v) => (
            <div className="source-record" key={v.id}>
              <h3>{v.title}</h3>
              <div className="beta-grid">
                {[
                  ["Player loads", v.data.stats?.load_count],
                  ["Plays", v.data.stats?.play_count],
                  [
                    "Play rate %",
                    v.data.stats?.play_rate == null
                      ? null
                      : v.data.stats.play_rate * 100,
                  ],
                  [
                    "Average engagement %",
                    v.data.stats?.engagement == null
                      ? null
                      : v.data.stats.engagement * 100,
                  ],
                  ["Hours watched", v.data.stats?.hours_watched],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className="caption">{label}</span>
                    <p>{fmt(value)}</p>
                  </div>
                ))}
              </div>
              <p className="caption">{v.data.statsScope}</p>
              <Source api={api} record={v} />
            </div>
          ))
        ) : (
          <Empty>No Wistia videos imported.</Empty>
        )}
      </Panel>
    </>
  );
}
function Evidence({ api, version, act, busy }) {
  const [kind, setKind] = useState(""),
    [q, setQ] = useState("");
  const data = useData(
    api,
    `/api/beta/evidence?kind=${kind}&q=${encodeURIComponent(q)}`,
    version,
  );
  return (
    <>
      <Panel title="Import a transcript or existing resource">
        <p>
          Use this for workflow exports, existing email/SMS sequences, articles,
          or transcripts unavailable through the provider. Upload plain text or
          paste the actual source. Titles and links alone are not evidence.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(() =>
              api("/api/beta/evidence", {
                method: "POST",
                body: Object.fromEntries(f),
              }),
            );
          }}
        >
          <Field label="Title">
            <input name="title" required />
          </Field>
          <Field label="Evidence type">
            <select name="kind">
              <option value="resource">Resource / workflow sequence</option>
              <option value="call">Call transcript</option>
              <option value="message">Email or SMS</option>
            </select>
          </Field>
          <Field label="Call stage">
            <select name="stage">
              <option value="resource">Resource</option>
              <option value="setting">Setting call</option>
              <option value="closing">Closing call</option>
            </select>
          </Field>
          <Field label="Source URL (optional)">
            <input name="sourceUrl" type="url" />
          </Field>
          <Field label="Source text">
            <textarea name="text" id="evidence-text" required rows={8} />
          </Field>
          <Field label="Or load a text file">
            <input
              type="file"
              accept=".txt,.md,.csv,.json"
              onChange={async (e) => {
                const f = e.target.files[0];
                if (f) {
                  if (f.size > 90000) return;
                  document.getElementById("evidence-text").value =
                    await f.text();
                }
              }}
            />
          </Field>
          <Button disabled={busy}>Save evidence</Button>
        </form>
      </Panel>
      <Panel title="Import a source article">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const url = new FormData(e.currentTarget).get("url");
            act(() =>
              api("/api/beta/article", { method: "POST", body: { url } }),
            );
          }}
        >
          <Field label="Public article URL">
            <input name="url" type="url" required />
          </Field>
          <Button disabled={busy}>Read and save article</Button>
        </form>
        <p>
          Imports accessible page text with its source link. For social videos,
          use a collected competitor reference or upload the media/transcript
          below.
        </p>
      </Panel>
      <Panel title="Repurpose a video or voice recording">
        <p>
          Upload MP4, WebM, MP3, WAV or M4A files up to 24 MB. The original
          stays in this workspace. Transcription uses the beta’s OpenAI account;
          check the transcript against the recording before generating copy.
          Larger files can be supplied as an exported transcript.
        </p>
        <label>
          <input type="checkbox" id="media-consent" /> I can share this
          recording with OpenAI for transcription
        </label>
        <Field label="Upload recording">
          <input
            type="file"
            accept="video/mp4,video/webm,audio/mpeg,audio/wav,audio/mp4"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files[0];
              if (f)
                act(async () => {
                  if (!document.getElementById("media-consent").checked)
                    throw Error("Confirm transcription consent first.");
                  if (f.size > 24 * 1024 * 1024)
                    throw Error(
                      "Use a file up to 24 MB or upload the transcript.",
                    );
                  const r = await api("/api/beta/media", {
                    method: "POST",
                    rawBody: f,
                    headers: {
                      "Content-Type": f.type,
                      "X-File-Name": encodeURIComponent(f.name),
                      "X-Transcription-Consent": "true",
                    },
                  });
                  if (r.warning) throw Error(r.warning);
                });
              e.target.value = "";
            }}
          />
        </Field>
      </Panel>
      <ResearchReferences api={api} version={version} act={act} />
      <div className="filters">
        <Field label="Search evidence">
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Type">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            {[
              "call",
              "resource",
              "message",
              "ad_day",
              "owned_ad",
              "video",
              "payment",
              "opportunity",
            ].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorView error={data.error} />
      {data.data?.length ? (
        data.data.map((r) => <Source api={api} key={r.id} record={r} />)
      ) : (
        <Empty>
          No matching evidence. Import a connected source or add a document
          above.
        </Empty>
      )}
    </>
  );
}
function Objections({ api, version, act, busy }) {
  const data = useData(api, "/api/beta/objections", version),
    [board, setBoard] = useState("objections-inbox"),
    [stage, setStage] = useState(""),
    [manual, setManual] = useState(false);
  const sources = useData(api, "/api/beta/evidence?kind=call", version);
  return (
    <>
      <ErrorView error={data.error} />
      <div className="stat-grid">
        {data.data?.themes.map((t) => (
          <div className="stat-card" key={t.theme}>
            <span>{t.theme}</span>
            <strong className="beta-number">{t.callCount}</strong>
            <span className="caption">
              Distinct calls · {t.confirmed} confirmed entries
            </span>
          </div>
        ))}
      </div>
      <p className="research-note">{data.data?.note}</p>
      <div className="beta-grid">
        <Panel title="Boards">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(() =>
                api("/api/beta/objection-boards", {
                  method: "POST",
                  body: { name: f.get("name"), notes: f.get("notes") },
                }),
              );
            }}
          >
            <Field label="Board name">
              <input name="name" required />
            </Field>
            <Field label="Purpose and notes">
              <textarea name="notes" />
            </Field>
            <Button disabled={busy}>Create board</Button>
          </form>
        </Panel>
        <Panel title="Review scope">
          <Field label="Save to board">
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {data.data?.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stage">
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">Setting and closing</option>
              <option value="setting">Setting</option>
              <option value="closing">Closing</option>
            </select>
          </Field>
          <p>
            Confirm that an excerpt expresses the prospect’s concern. A closer
            discussing an objection does not establish that the prospect raised
            it.
          </p>
          <Button onClick={() => setManual(!manual)}>
            Add an exact excerpt manually
          </Button>
        </Panel>
      </div>
      {manual && (
        <Panel title="Add evidence">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(() =>
                api("/api/beta/objections", {
                  method: "POST",
                  body: {
                    boardId: board,
                    evidenceId: f.get("evidenceId"),
                    theme: f.get("theme"),
                    excerpt: f.get("excerpt"),
                    notes: f.get("notes"),
                    confirmed: f.get("confirmed") === "on",
                  },
                }),
              );
            }}
          >
            <Field label="Source call">
              <select name="evidenceId">
                {sources.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Theme">
              <input name="theme" required />
            </Field>
            <Field label="Verbatim excerpt">
              <textarea name="excerpt" required />
            </Field>
            <Field label="Notes">
              <textarea name="notes" />
            </Field>
            <label>
              <input type="checkbox" name="confirmed" /> I checked the source
              and speaker
            </label>
            <Button disabled={busy}>Save excerpt</Button>
          </form>
        </Panel>
      )}
      <Panel title="Suggested objections">
        {data.data?.candidates
          .filter((c) => !stage || c.stage === stage)
          .map((c) => (
            <div className="source-record" key={c.evidenceId + c.theme}>
              <strong>
                {c.theme} · {c.stage}
              </strong>
              <blockquote>{c.excerpt}</blockquote>
              <p>
                {c.title} · {c.occurredAt}
              </p>
              <Link url={c.sourceUrl} />
              <details>
                <summary>Read call context</summary>
                <pre>
                  {
                    sources.data?.find((s) => s.id === c.evidenceId)?.data
                      .transcript
                  }
                </pre>
              </details>
              <Button
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api("/api/beta/objections", {
                      method: "POST",
                      body: {
                        boardId: board,
                        evidenceId: c.evidenceId,
                        theme: c.theme,
                        excerpt: c.excerpt,
                        confirmed: true,
                        notes: "",
                      },
                    }),
                  )
                }
              >
                Confirm and save to board
              </Button>
            </div>
          ))}
        {!data.data?.candidates.length && (
          <Empty>
            No suggested objections. Import or upload call transcripts first.
          </Empty>
        )}
      </Panel>
      <Panel title="Saved in this board">
        {data.data?.entries
          .filter((e) => e.board_id === board)
          .map((e) => (
            <div className="source-record" key={e.id}>
              <strong>
                {e.theme} · {e.confirmed ? "Confirmed" : "Unconfirmed"}
              </strong>
              <blockquote>{e.excerpt}</blockquote>
              <p>{e.notes}</p>
            </div>
          ))}
      </Panel>
    </>
  );
}
function Comments({ api, version, act, type, id, slideId }) {
  const data = useData(
    api,
    `/api/beta/comments?type=${type}&id=${id}`,
    version,
  );
  return (
    <Panel title="Client and Levr comments">
      <ErrorView error={data.error} />
      {data.data?.map((c) => (
        <div className="source-record" key={c.id}>
          <strong>{c.author}</strong>
          <small>
            {" "}
            {c.created_at} {c.slide_id ? "· Slide comment" : ""}
          </small>
          <p>{c.body}</p>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act(() =>
            api("/api/beta/comments", {
              method: "POST",
              body: { type, targetId: id, slideId, body: f.get("body") },
            }),
          );
          e.currentTarget.reset();
        }}
      >
        <Field label="Comment">
          <textarea name="body" required />
        </Field>
        <Button>Add comment</Button>
      </form>
    </Panel>
  );
}
function Stage({ record, type, api, act, owner }) {
  return (
    <div className="beta-actions">
      <span className="badge">
        {record.stage} · Revision {record.revision}
      </span>
      {[
        "Draft",
        "In review",
        ...(owner ? ["Approved", "In production", "Live", "Reviewed"] : []),
      ]
        .filter((s) => s !== record.stage)
        .map((stage) => (
          <Button
            key={stage}
            onClick={() =>
              act(() =>
                api(`/api/beta/${type}/${record.id}/stage`, {
                  method: "POST",
                  body: { stage, revision: record.revision },
                }),
              )
            }
          >
            {stage === "Approved" ? "Approve revision" : stage}
          </Button>
        ))}
    </div>
  );
}
function Campaigns({ api, version, act, busy, owner, go }) {
  const data = useData(api, "/api/beta/campaigns", version),
    boards = useData(api, "/api/beta/objections", version);
  const [selected, setSelected] = useState(""),
    [editor, setEditor] = useState(""),
    [editing, setEditing] = useState(false);
  const r = data.data?.find((c) => c.id === selected);
  const source = useData(api, "/api/beta/evidence", version);
  return (
    <>
      <Panel title="Create a coordinated campaign">
        <p>
          Choose a confirmed objection board. Generation combines the offer
          profile with source evidence and produces drafts for your selected
          channels. Generation sends the selected source evidence to OpenAI
          through the beta’s secure integration. Manual drafts work without it.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(async () => {
              const made = await api("/api/beta/campaigns", {
                method: "POST",
                body: {
                  title: f.get("title"),
                  boardId: f.get("board"),
                  framework: f.get("framework"),
                  formats: f.getAll("formats"),
                  cta: {
                    text: f.get("cta"),
                    override: f.get("override") === "on",
                  },
                  manual: f.get("manual") === "on",
                  sourceIds: f.getAll("references"),
                },
              });
              setSelected(made.id);
            });
          }}
        >
          <div className="beta-grid">
            <Field label="Campaign title">
              <input name="title" required />
            </Field>
            <Field label="Objection board">
              <select name="board">
                {boards.data?.boards.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Video framework">
              <select name="framework">
                <option value="yapp_short">YappMaxxing short-form</option>
                <option value="yapp_long">YappMaxxing long-form</option>
                <option value="diamond">Belief Breaking Diamond</option>
                <option value="hpvc">Hook–Proof–Value–CTA</option>
              </select>
            </Field>
            <Field label="Approved CTA / resource">
              <input name="cta" />
            </Field>
          </div>
          <div className="beta-actions">
            {["email", "sms", "video", "paid_ad", "carousel", "nurture"].map(
              (f) => (
                <label key={f}>
                  <input
                    type="checkbox"
                    name="formats"
                    value={f}
                    defaultChecked
                  />
                  {f}
                </label>
              ),
            )}
          </div>
          <details>
            <summary>Include source documents or competitor evidence</summary>
            {source.data
              ?.filter((s) => ["resource", "message", "call"].includes(s.kind))
              .map((s) => (
                <label className="source-choice" key={s.id}>
                  <input type="checkbox" name="references" value={s.id} />
                  {s.title}
                </label>
              ))}
          </details>
          <label>
            <input type="checkbox" name="override" /> Allow a CTA in an
            otherwise no-CTA video framework
          </label>
          <br />
          <label>
            <input type="checkbox" name="manual" /> Create a manual draft
            without AI
          </label>
          <br />
          <Button disabled={busy}>
            {busy ? "Working…" : "Create campaign draft"}
          </Button>
        </form>
      </Panel>
      <ErrorView error={data.error} />
      <Field label="Saved campaign">
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setEditing(false);
          }}
        >
          <option value="">Select a draft</option>
          {data.data?.map((c) => (
            <option value={c.id} key={c.id}>
              {c.title} · {c.stage}
            </option>
          ))}
        </select>
      </Field>
      {r && (
        <>
          <Panel title={r.title}>
            <Stage
              record={r}
              type="campaigns"
              api={api}
              act={act}
              owner={owner}
            />
            <p>{r.data.summary}</p>
            <h3>Source Evidence</h3>
            {r.data.sourceEvidence?.map((s) => (
              <div className="source-record" key={s.id}>
                <p>{s.reason}</p>
                {source.data?.find((x) => x.id === s.id) && (
                  <Source
                    api={api}
                    record={source.data.find((x) => x.id === s.id)}
                  />
                )}
              </div>
            ))}
            <h3>Our Original Adaptation</h3>
            <p>{r.data.originalAdaptation?.angle}</p>
            {r.data.originalAdaptation?.sequence?.map((a, i) => (
              <details className="source-record" key={i} open>
                <summary>
                  {i + 1}. {a.format} · {a.objective}
                </summary>
                {Object.entries(a)
                  .filter(([k]) => !["format", "objective"].includes(k))
                  .map(([k, v]) => (
                    <div key={k}>
                      <h4>{fieldLabel(k)}</h4>
                      <pre>{typeof v === "string" ? v : json(v)}</pre>
                    </div>
                  ))}
              </details>
            ))}
            {!!r.data.proofNeeded?.length && (
              <div className="notice">
                <strong>Proof needed before approval</strong>
                <ul>
                  {r.data.proofNeeded.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="beta-actions">
              <Button
                onClick={() => {
                  setEditor(structuredClone(r.data));
                  setEditing(!editing);
                }}
              >
                Edit draft
              </Button>
              <Button
                onClick={() =>
                  act(async () => {
                    await api("/api/beta/carousels", {
                      method: "POST",
                      body: {
                        title: r.title,
                        style: "brand",
                        campaignId: r.id,
                      },
                    });
                    go("studio");
                  })
                }
              >
                Create carousel from brief
              </Button>
              <Button
                onClick={() => navigator.clipboard.writeText(json(r.data))}
              >
                Copy brief
              </Button>
            </div>
            {editing && (
              <CampaignEditor
                draft={editor}
                onChange={setEditor}
                busy={busy}
                onSave={() =>
                  act(async () => {
                    await api(`/api/beta/campaigns/${r.id}`, {
                      method: "PATCH",
                      body: {
                        revision: r.revision,
                        title: r.title,
                        data: editor,
                      },
                    });
                    setEditing(false);
                  })
                }
              />
            )}
          </Panel>
          <Comments
            api={api}
            version={version}
            act={act}
            type="campaigns"
            id={r.id}
          />
        </>
      )}
    </>
  );
}
function AssetLibrary({ api, version, act, busy }) {
  const data = useData(api, "/api/beta/assets", version);
  return (
    <Panel title="Your private photo library">
      <p>
        Upload original JPEG, PNG or WebP files, up to 20 MB each. Use
        portraits, working scenes, lifestyle photos and service images. Portrait
        photos with space to the left or right of the subject work best. Keep
        faces away from text. No photo repeats inside a carousel; a four-panel
        collage needs four different images.
      </p>
      <Field label="Upload photos or logo">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            const files = [...e.target.files];
            act(async () => {
              for (const f of files)
                await api("/api/beta/assets", {
                  method: "POST",
                  rawBody: f,
                  headers: {
                    "Content-Type": f.type,
                    "X-File-Name": encodeURIComponent(f.name),
                  },
                });
            });
            e.target.value = "";
          }}
        />
      </Field>
      <ErrorView error={data.error} />
      <div className="asset-list">
        {data.data?.map((a) => (
          <Photo key={a.id} asset={a} api={api} />
        ))}
      </div>
    </Panel>
  );
}
function Photo({ asset, api }) {
  const [url, set] = useState("");
  useEffect(() => {
    let active = true,
      u;
    api(`/api/beta/assets/${asset.id}`, { binary: true }).then((b) => {
      u = URL.createObjectURL(b);
      if (active) set(u);
    });
    return () => {
      active = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [asset.id]);
  return (
    <figure>
      {url && <img src={url} alt={fileName(asset.name)} />}
      <figcaption>{fileName(asset.name)}</figcaption>
    </figure>
  );
}
function Studio({ api, version, act, busy, owner }) {
  const data = useData(api, "/api/beta/carousels", version),
    assets = useData(api, "/api/beta/assets", version);
  const [id, setId] = useState(""),
    [draft, setDraft] = useState(null),
    [slide, setSlide] = useState(0);
  const record = data.data?.find((c) => c.id === id);
  const previews = useData(
    api,
    id
      ? `/api/beta/carousels/${id}/preview?slide=${slide}`
      : "/api/beta/carousels",
    version,
  );
  useEffect(() => {
    if (record) setDraft(structuredClone(record.data));
  }, [record]);
  const s = draft?.slides[slide];
  const editSlide = (key, value) =>
    setDraft((d) => ({
      ...d,
      slides: d.slides.map((s, i) =>
        i === slide ? { ...s, [key]: value } : s,
      ),
    }));
  return (
    <>
      <Panel title="Create a carousel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            act(async () => {
              const c = await api("/api/beta/carousels", {
                method: "POST",
                body: { title: f.get("title"), style: f.get("style") },
              });
              setId(c.id);
              setSlide(0);
            });
          }}
        >
          <div className="beta-grid">
            <Field label="Carousel title">
              <input name="title" required />
            </Field>
            <Field label="Visual style">
              <select name="style">
                <option value="brand">Branded text-led</option>
                <option value="photo">Editorial photo</option>
              </select>
            </Field>
          </div>
          <Button disabled={busy}>Create carousel</Button>
        </form>
        <p>
          Create from a Campaign brief to start with its outline and evidence,
          or write your own here. Supplied examples guide the style; client
          assets supply the photos.
        </p>
      </Panel>
      <Field label="Saved carousel">
        <select
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setSlide(0);
          }}
        >
          <option value="">Select carousel</option>
          {data.data?.map((c) => (
            <option value={c.id} key={c.id}>
              {c.title} · {c.stage}
            </option>
          ))}
        </select>
      </Field>
      <ErrorView error={data.error || previews.error} />
      {record && draft && s && (
        <>
          <Panel title={record.title}>
            <Stage
              record={record}
              type="carousels"
              api={api}
              act={act}
              owner={owner}
            />
            <div className="studio-layout">
              <div className="slide-list">
                {draft.slides.map((s, i) => (
                  <Button
                    key={s.id}
                    aria-pressed={slide === i}
                    onClick={() => setSlide(i)}
                  >
                    {i + 1}. {s.heading || "Untitled"}
                  </Button>
                ))}
                <Button
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      slides: [
                        ...d.slides,
                        {
                          id: crypto.randomUUID(),
                          heading: "New idea",
                          body: "",
                          takeaway: "",
                          photos: [],
                          layout: "single",
                          position: "left",
                        },
                      ],
                    }));
                    setSlide(draft.slides.length);
                  }}
                  disabled={draft.slides.length >= 20}
                >
                  Add slide
                </Button>
              </div>
              <div className="slide-preview">
                {previews.data?.slides?.[0] && (
                  <SlidePreview
                    html={previews.data.slides[0]}
                    number={slide + 1}
                  />
                )}
                <p className="caption">
                  Preview shows the saved revision. Save edits to refresh.
                </p>
              </div>
              <div className="slide-controls">
                <Field label="Headline">
                  <textarea
                    value={s.heading}
                    onChange={(e) => editSlide("heading", e.target.value)}
                    maxLength={180}
                  />
                </Field>
                <Field label="Body">
                  <textarea
                    value={s.body}
                    onChange={(e) => editSlide("body", e.target.value)}
                    rows={5}
                    maxLength={900}
                  />
                </Field>
                <Field label="Takeaway">
                  <textarea
                    value={s.takeaway}
                    onChange={(e) => editSlide("takeaway", e.target.value)}
                    maxLength={250}
                  />
                </Field>
                <Field label="Text position">
                  <select
                    value={s.position}
                    onChange={(e) => editSlide("position", e.target.value)}
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <Field label="Layout">
                  <select
                    value={s.layout}
                    onChange={(e) => {
                      editSlide("layout", e.target.value);
                      editSlide("photos", []);
                    }}
                  >
                    <option value="single">Single photo / statement</option>
                    <option value="collage">Four-photo collage</option>
                  </select>
                </Field>
                {draft.style === "photo" &&
                  Array.from(
                    { length: s.layout === "collage" ? 4 : 1 },
                    (_, i) => (
                      <Field key={i} label={`Photo ${i + 1}`}>
                        <select
                          value={s.photos[i] || ""}
                          onChange={(e) => {
                            const a = [...s.photos];
                            a[i] = e.target.value;
                            editSlide("photos", a.filter(Boolean));
                          }}
                        >
                          <option value="">Choose photo</option>
                          {assets.data?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {fileName(a.name)}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ),
                  )}
                {draft.style === "photo" &&
                  ["cropX", "cropY"].map((k) => (
                    <Field
                      key={k}
                      label={
                        k === "cropX" ? "Horizontal crop" : "Vertical crop"
                      }
                    >
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={s[k] ?? 50}
                        onChange={(e) => editSlide(k, Number(e.target.value))}
                      />
                    </Field>
                  ))}
                <div className="beta-actions">
                  <Button
                    disabled={slide === 0}
                    onClick={() => {
                      const a = [...draft.slides];
                      [a[slide - 1], a[slide]] = [a[slide], a[slide - 1]];
                      setDraft({ ...draft, slides: a });
                      setSlide(slide - 1);
                    }}
                  >
                    Move earlier
                  </Button>
                  <Button
                    disabled={draft.slides.length <= 2}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        slides: draft.slides.filter((_, i) => i !== slide),
                      });
                      setSlide(Math.max(0, slide - 1));
                    }}
                  >
                    Remove slide
                  </Button>
                </div>
              </div>
            </div>
            <Field label="Saved carousel style">
              <select
                value={draft.style}
                onChange={(e) => setDraft({ ...draft, style: e.target.value })}
              >
                <option value="brand">Branded text-led</option>
                <option value="photo">Editorial photo</option>
              </select>
            </Field>
            <Field label="Caption">
              <textarea
                value={draft.caption}
                onChange={(e) =>
                  setDraft({ ...draft, caption: e.target.value })
                }
                rows={4}
              />
            </Field>
            <Field label="Brand handle or footer">
              <input
                value={draft.handle}
                onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
              />
            </Field>
            <div className="beta-actions">
              <Button
                disabled={busy}
                onClick={() =>
                  act(() =>
                    api(`/api/beta/carousels/${id}`, {
                      method: "PATCH",
                      body: {
                        revision: record.revision,
                        title: record.title,
                        data: draft,
                      },
                    }),
                  )
                }
              >
                Save revision
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const blob = await api(`/api/beta/carousels/${id}/export`, {
                      method: "POST",
                      binary: true,
                    });
                    const u = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = u;
                    a.download = `carousel-${id}.zip`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(u), 10000);
                  })
                }
              >
                Export saved carousel ZIP
              </Button>
            </div>
            <p className="caption">
              Exports contain 1080 × 1350 PNG slides, caption and editable
              project. Any edit resets approval. Photo styles require unique
              images for every placement.
            </p>
          </Panel>
          <Comments
            api={api}
            version={version}
            act={act}
            type="carousels"
            id={id}
            slideId={s.id}
          />
        </>
      )}
      <AssetLibrary api={api} version={version} act={act} busy={busy} />
    </>
  );
}
function Outcomes({ api, version, act, busy }) {
  const data = useData(api, "/api/beta/analytics", version),
    [selected, setSelected] = useState(""),
    [v, setV] = useState(null);
  useEffect(() => {
    if (selected && data.data)
      setV({
        callOutcome: "Unknown",
        salesOutcome: "Unknown",
        objection: "",
        lossReason: "",
        contractValue: null,
        currency: "",
        nextAction: "",
        followUpDate: "",
        ...data.data.outcomes[selected],
      });
  }, [selected, data.data]);
  return (
    <>
      <Panel title="Standard sales tracking">
        <p>
          Recommended GoHighLevel pipeline: New lead → Contact attempted →
          Qualified → Closing call booked → Call attended → Decision pending.
          Use Won / Lost / Abandoned opportunity statuses. Record appointment
          outcomes separately.
        </p>
        <p>
          These dashboard notes do not modify GoHighLevel. Configure the
          matching fields in each sub-account and train setters and closers to
          update them after every call. Missing historical outcomes stay
          Unknown.
        </p>
        <p>
          Contract value is not collected revenue. Stripe is the payment source;
          CRM values are not added to Stripe totals.
        </p>
      </Panel>
      <ErrorView error={data.error} />
      <Panel title="Record or review a sales outcome">
        <Field label="CRM opportunity">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose opportunity</option>
            {data.data?.opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} ·{" "}
                {data.data.outcomes[o.id]?.salesOutcome || "Outcome missing"}
              </option>
            ))}
          </select>
        </Field>
        {v && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api(`/api/beta/outcomes/${selected}`, {
                  method: "PUT",
                  body: v,
                }),
              );
            }}
          >
            <div className="beta-grid">
              <Field label="Appointment outcome">
                <select
                  value={v.callOutcome}
                  onChange={(e) => setV({ ...v, callOutcome: e.target.value })}
                >
                  {[
                    "Unknown",
                    "Attended",
                    "No-show",
                    "Cancelled",
                    "Rescheduled",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sales outcome">
                <select
                  value={v.salesOutcome}
                  onChange={(e) => setV({ ...v, salesOutcome: e.target.value })}
                >
                  {[
                    "Unknown",
                    "Follow-up needed",
                    "Won",
                    "Lost",
                    "Abandoned",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            {[
              "objection",
              "lossReason",
              "currency",
              "nextAction",
              "followUpDate",
            ].map((k) => (
              <Field
                key={k}
                label={
                  {
                    objection: "Main objection",
                    lossReason: "Loss reason (or Unknown)",
                    currency: "Contract currency",
                    nextAction: "Next action",
                    followUpDate: "Follow-up date",
                  }[k]
                }
              >
                <input
                  type={k === "followUpDate" ? "date" : "text"}
                  value={v[k]}
                  onChange={(e) => setV({ ...v, [k]: e.target.value })}
                />
              </Field>
            ))}
            <Field label="Agreed contract value">
              <input
                type="number"
                min="0"
                step="0.01"
                value={v.contractValue ?? ""}
                onChange={(e) =>
                  setV({
                    ...v,
                    contractValue:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Button disabled={busy}>Save outcome note</Button>
          </form>
        )}
      </Panel>
      <Panel title="Match collected payments to deals">
        <p>
          Match payments only when you have identified the correct deal. This
          establishes the revenue link; it does not by itself establish ad
          attribution.
        </p>
        {data.data?.payments.map((p) => (
          <form
            className="source-record"
            key={p.id}
            onSubmit={(e) => {
              e.preventDefault();
              act(() =>
                api("/api/beta/revenue-links", {
                  method: "POST",
                  body: {
                    paymentId: p.id,
                    opportunityId: new FormData(e.currentTarget).get(
                      "opportunity",
                    ),
                  },
                }),
              );
            }}
          >
            <strong>
              {p.title} · {p.data.currency}
            </strong>
            <p>
              {p.data.email || "Email unavailable"} ·{" "}
              {p.occurred_at?.slice(0, 10)}
            </p>
            <Link url={p.data.sourceUrl} />
            <Field label="Matched opportunity">
              <select
                name="opportunity"
                defaultValue={
                  data.data.links.find((l) => l.payment_id === p.id)
                    ?.opportunity_id || ""
                }
                required
              >
                <option value="">Unmatched</option>
                {data.data.opportunities.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button disabled={busy}>Save match</Button>
          </form>
        ))}
        {!data.data?.payments.length && (
          <Empty>No Stripe payments imported yet.</Empty>
        )}
      </Panel>
    </>
  );
}

function CampaignEditor({ draft, onChange, onSave, busy }) {
  const assets = draft.originalAdaptation.sequence || [];
  const update = (index, key, value) =>
    onChange({
      ...draft,
      originalAdaptation: {
        ...draft.originalAdaptation,
        sequence: assets.map((a, i) =>
          i === index ? { ...a, [key]: value } : a,
        ),
      },
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p>
        Changes create a new revision and reset approval. Keep source evidence
        separate from your copy.
      </p>
      <Field label="Campaign summary">
        <textarea
          value={draft.summary || ""}
          onChange={(e) => onChange({ ...draft, summary: e.target.value })}
        />
      </Field>
      <Field label="Creative angle">
        <textarea
          value={draft.originalAdaptation.angle || ""}
          onChange={(e) =>
            onChange({
              ...draft,
              originalAdaptation: {
                ...draft.originalAdaptation,
                angle: e.target.value,
              },
            })
          }
        />
      </Field>
      {assets.map((a, i) => (
        <fieldset key={i}>
          <legend>
            Asset {i + 1}: {a.format}
          </legend>
          <Field label={`Asset ${i + 1} format`}>
            <select
              value={a.format}
              onChange={(e) => update(i, "format", e.target.value)}
            >
              {["email", "sms", "video", "paid_ad", "carousel", "nurture"].map(
                (format) => (
                  <option key={format}>{format}</option>
                ),
              )}
            </select>
          </Field>
          {[
            "objective",
            "audience",
            "angle",
            "hook",
            "fullCopy",
            "caption",
            "deliveryTrigger",
            "proofPlan",
            "cta",
            "structure",
            "shotList",
            "skeleton",
            "qualityChecks",
          ]
            .filter((k) => k !== "shotList" || a.format !== "carousel")
            .map((k) => (
              <Field
                key={k}
                label={
                  {
                    fullCopy: "Full copy / spoken script",
                    deliveryTrigger: "Delivery trigger",
                    proofPlan: "Proof plan",
                    shotList: "Shot list or slide outline",
                    qualityChecks: "Quality review",
                  }[k] || k
                }
              >
                <textarea
                  rows={k === "fullCopy" ? 8 : 3}
                  value={
                    Array.isArray(a[k])
                      ? a[k]
                          .map((v) => (typeof v === "string" ? v : json(v)))
                          .join("\n")
                      : typeof a[k] === "object"
                        ? json(a[k])
                        : a[k] || ""
                  }
                  onChange={(e) => update(i, k, e.target.value)}
                />
              </Field>
            ))}
          {a.format === "carousel" && (
            <div>
              <h4>Slide outline</h4>
              {(Array.isArray(a.shotList) ? a.shotList : []).map(
                (slide, index) => {
                  const value =
                    typeof slide === "string"
                      ? { heading: slide, body: "", takeaway: "" }
                      : slide;
                  return (
                    <fieldset key={index}>
                      <legend>Slide {index + 1}</legend>
                      {["heading", "body", "takeaway", "photoBrief"].map(
                        (key) => (
                          <Field key={key} label={`Slide ${index + 1} ${key}`}>
                            <textarea
                              value={value[key] || ""}
                              onChange={(e) =>
                                update(
                                  i,
                                  "shotList",
                                  a.shotList.map((s, j) =>
                                    j === index
                                      ? { ...value, [key]: e.target.value }
                                      : s,
                                  ),
                                )
                              }
                            />
                          </Field>
                        ),
                      )}
                    </fieldset>
                  );
                },
              )}
              <Button
                type="button"
                onClick={() =>
                  update(i, "shotList", [
                    ...(Array.isArray(a.shotList) ? a.shotList : []),
                    { heading: "", body: "", takeaway: "" },
                  ])
                }
              >
                Add slide outline
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      <Button
        type="button"
        onClick={() =>
          onChange({
            ...draft,
            originalAdaptation: {
              ...draft.originalAdaptation,
              sequence: [
                ...assets,
                { format: "email", objective: "", fullCopy: "" },
              ],
            },
          })
        }
      >
        Add asset
      </Button>
      <Field label="Proof still needed (one item per line)">
        <textarea
          value={(draft.proofNeeded || []).join("\n")}
          onChange={(e) =>
            onChange({
              ...draft,
              proofNeeded: e.target.value.split("\n").filter(Boolean),
            })
          }
        />
      </Field>
      <Button disabled={busy}>Save revision</Button>
    </form>
  );
}

function SlidePreview({ html, number }) {
  const ref = useRef(null),
    [scale, setScale] = useState(0.3);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setScale(entries[0].contentRect.width / 1080),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="slide-canvas">
      <iframe
        title={`Slide ${number} saved preview`}
        sandbox=""
        srcDoc={html}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

function AskIntelligence({ api, version, act, busy }) {
  const [answer, setAnswer] = useState(null);
  const sources = useData(api, "/api/beta/evidence", version);
  return (
    <>
      <Panel title="Ask your workspace">
        <p>
          Ask about imported calls, offers, existing messages, video engagement
          or ad results. Answers link to stored sources. With the AI connection
          enabled, relevant evidence is sent to OpenAI for analysis.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const question = new FormData(e.currentTarget).get("question");
            act(async () =>
              setAnswer(
                await api("/api/beta/ask", {
                  method: "POST",
                  body: { question },
                }),
              ),
            );
          }}
        >
          <Field label="Your question">
            <textarea
              name="question"
              required
              placeholder="Which implementation concerns keep appearing in closing calls?"
              rows={4}
            />
          </Field>
          <Button disabled={busy}>
            {busy ? "Reviewing evidence…" : "Ask intelligence"}
          </Button>
        </form>
      </Panel>
      {answer && (
        <Panel title="Evidence-grounded answer">
          <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>
          {answer.citations.map((c) => {
            const source = sources.data?.find((s) => s.id === c.id);
            return source ? (
              <Source api={api} key={c.id} record={source} />
            ) : null;
          })}
        </Panel>
      )}
    </>
  );
}

function ResearchReferences({ api, version, act }) {
  const data = useData(api, "/api/beta/competitor-references", version);
  return (
    <details className="source-record">
      <summary>Bring in a competitor reference</summary>
      <p>
        Import competitors through the existing research pages, then add the
        relevant creative here for campaign briefs. Evidence stays separate from
        original adaptation.
      </p>
      {data.data?.map((r) => (
        <div className="source-record" key={r.id}>
          <strong>
            {r.title || r.caption?.slice(0, 120) || "Creative reference"}
          </strong>
          <p>{r.format}</p>
          <Button
            onClick={() =>
              act(() =>
                api(`/api/beta/competitor-references/${r.id}`, {
                  method: "POST",
                }),
              )
            }
          >
            Add to campaign evidence
          </Button>
        </div>
      ))}
      {!data.data?.length && <p>No competitor creative collected yet.</p>}
    </details>
  );
}

function MediaPlayer({ api, assetId }) {
  const [url, set] = useState("");
  useEffect(() => {
    let active = true,
      u;
    api(`/api/beta/assets/${assetId}`, { binary: true })
      .then((b) => {
        u = URL.createObjectURL(b);
        if (active) set(u);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [assetId]);
  return url ? (
    <video controls src={url} style={{ maxWidth: "100%", maxHeight: 450 }} />
  ) : (
    <p>Loading original recording…</p>
  );
}
function SpendTrend({ rows, currency }) {
  const daily = {};
  for (const r of rows)
    if (r.data.currency === currency && r.data.spend != null)
      daily[r.occurred_at] = (daily[r.occurred_at] || 0) + r.data.spend;
  const days = Object.keys(daily).sort(),
    max = Math.max(1, ...Object.values(daily)),
    points = days
      .map(
        (d, i) =>
          `${40 + (i * 920) / Math.max(1, days.length - 1)},${180 - (daily[d] * 150) / max}`,
      )
      .join(" ");
  return (
    <Panel title="Daily ad spend">
      <svg
        viewBox="0 0 1000 220"
        role="img"
        aria-label={`Daily spend in ${currency} from ${days[0]} to ${days.at(-1)}`}
        style={{ width: "100%", height: "auto" }}
      >
        <path d="M40 20 V180 H960" fill="none" stroke="#e3e0da" />
        <polyline
          points={points}
          fill="none"
          stroke="#121212"
          strokeWidth="3"
        />
        <text x="40" y="210" fill="#6b6862" fontSize="16">
          {days[0]}
        </text>
        <text x="820" y="210" fill="#6b6862" fontSize="16">
          {days.at(-1)}
        </text>
        <text x="40" y="15" fill="#6b6862" fontSize="14">
          Peak: {fmt(max)} {currency}
        </text>
      </svg>
      <p className="caption">
        Daily totals within the selected date range. Gaps reflect imported
        reporting dates.
      </p>
    </Panel>
  );
}
