// Read-only provider adapters. Never fetch a URL supplied by provider pagination.
export const providers = ["meta", "ghl", "fathom", "wistia", "stripe"];
export class IntegrationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.safeMessage = message;
    this.status = status;
  }
}
const roots = {
  meta: `https://graph.facebook.com/${process.env.META_API_VERSION || "v23.0"}`,
  ghl: "https://services.leadconnectorhq.com",
  fathom: "https://api.fathom.ai/external/v1",
  wistia: "https://api.wistia.com/v1",
  stripe: "https://api.stripe.com/v1",
};
export async function request(
  provider,
  path,
  key,
  { query = {}, method = "GET", body, fetchImpl = fetch } = {},
) {
  const url = new URL(roots[provider] + path);
  for (const [k, v] of Object.entries(query))
    if (v != null)
      url.searchParams.set(
        k,
        typeof v === "object" ? JSON.stringify(v) : String(v),
      );
  const headers = {
    Accept: "application/json",
    ...(provider === "fathom"
      ? { "X-Api-Key": key }
      : { Authorization: `Bearer ${key}` }),
    ...(provider === "ghl" ? { Version: "2021-07-28" } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new IntegrationError(
      `${provider}: connection failed or timed out. Retry the manual import.`,
    );
  }
  if (!response.ok)
    throw new IntegrationError(
      `${provider}: request returned HTTP ${response.status}. Check account access, read permissions and provider limits.`,
      response.status === 401 || response.status === 403 ? 400 : 502,
    );
  let size = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 20_000_000) throw Error();
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new IntegrationError(
      `${provider}: incomplete or unreadable response. Previous data is preserved.`,
    );
  }
}
const arr = (value, label) => {
  if (!Array.isArray(value))
    throw new IntegrationError(
      `${label}: response format changed. Previous data is preserved.`,
    );
  return value;
};
const num = (v) =>
  v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
export async function verifyConnection(provider, key, accountId, options = {}) {
  const get = (p, query) => request(provider, p, key, { query, ...options });
  if (provider === "meta") {
    if (!/^\d+$/.test(accountId))
      throw new IntegrationError(
        "Enter the numeric Meta ad account ID without act_.",
        400,
      );
    const r = await get(`/act_${accountId}`, {
      fields: "id,name,currency,timezone_name",
    });
    if (r.id !== `act_${accountId}`)
      throw new IntegrationError("Meta account did not match.", 400);
    return r;
  }
  if (provider === "ghl") {
    if (!/^[\w-]{5,100}$/.test(accountId))
      throw new IntegrationError(
        "Enter the client’s GoHighLevel location ID.",
        400,
      );
    const r = await get(`/locations/${accountId}`);
    if (r.location?.id !== accountId)
      throw new IntegrationError("GoHighLevel location did not match.", 400);
    return r.location;
  }
  if (provider === "stripe") {
    const r = await get("/account");
    if (!r.id)
      throw new IntegrationError("Stripe account verification failed.");
    if (accountId && accountId !== r.id)
      throw new IntegrationError("Stripe account did not match.", 400);
    return { id: r.id, name: r.business_profile?.name };
  }
  if (provider === "fathom") {
    await get("/meetings", { limit: 1 });
    return { id: accountId || "personal", name: "Fathom account" };
  }
  if (provider === "wistia") {
    const r = await get("/medias.json", { per_page: 1 });
    arr(r, "Wistia");
    return { id: accountId || "library", name: "Wistia library" };
  }
  throw new IntegrationError("Unsupported integration.", 400);
}
export async function importProvider(
  provider,
  key,
  accountId,
  {
    fetchImpl = fetch,
    since = new Date(Date.now() - 90 * 86400000).toISOString(),
  } = {},
) {
  const records = [],
    warnings = [],
    seen = new Set();
  const get = (p, query) => request(provider, p, key, { query, fetchImpl });
  const add = (kind, externalId, title, date, data) => {
    if (!externalId)
      throw new IntegrationError(`${provider}: missing record ID.`);
    records.push({
      kind,
      externalId: String(externalId),
      title: String(title || kind),
      occurredAt: date || null,
      data,
    });
  };
  const cursor = (token) => {
    if (seen.has(token))
      throw new IntegrationError(`${provider}: repeated pagination cursor.`);
    seen.add(token);
  };
  if (provider === "meta") {
    const account = await get(`/act_${accountId}`, {
      fields: "id,name,currency,timezone_name",
    });
    let after;
    do {
      const r = await get(`/act_${accountId}/insights`, {
        level: "ad",
        time_increment: 1,
        time_range: {
          since: since.slice(0, 10),
          until: new Date().toISOString().slice(0, 10),
        },
        fields:
          "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values",
        action_attribution_windows: ["7d_click", "1d_view"],
        limit: 500,
        after,
      });
      for (const a of arr(r.data, "Meta")) {
        const action = (field, type) =>
          num((a[field] || []).find((x) => x.action_type === type)?.value);
        add("ad_day", `${a.ad_id}:${a.date_start}`, a.ad_name, a.date_start, {
          ...a,
          spend: num(a.spend),
          impressions: num(a.impressions),
          linkClicks: num(a.inline_link_clicks),
          landingViews: action("actions", "landing_page_view"),
          leads: action("actions", "lead"),
          purchases: action("actions", "purchase"),
          revenue: action("action_values", "purchase"),
          currency: account.currency,
          timezone: account.timezone_name,
          attribution: "7-day click / 1-day view",
        });
      }
      after = r.paging?.next ? r.paging?.cursors?.after : null;
      if (r.paging?.next && !after)
        throw new IntegrationError(
          "Meta returned an unsupported pagination link.",
        );
      if (after) cursor(after);
    } while (after);
    let adAfter;
    seen.clear();
    do {
      const r = await get(`/act_${accountId}/ads`, {
        fields:
          "id,name,status,effective_status,campaign_id,adset_id,creative{id,title,body,thumbnail_url,image_url,object_story_spec}",
        limit: 100,
        after: adAfter,
      });
      for (const ad of arr(r.data, "Meta ads"))
        add("owned_ad", ad.id, ad.name, null, {
          ...ad,
          sourceUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId}&selected_ad_ids=${ad.id}`,
        });
      adAfter = r.paging?.next ? r.paging?.cursors?.after : null;
      if (r.paging?.next && !adAfter)
        throw new IntegrationError("Meta ad pagination incomplete.");
      if (adAfter) cursor(adAfter);
    } while (adAfter);
  }
  if (provider === "stripe") {
    let starting_after;
    do {
      const r = await get("/charges", {
        limit: 100,
        "created[gte]": Math.floor(Date.parse(since) / 1000),
        starting_after,
      });
      const rows = arr(r.data, "Stripe");
      for (const c of rows)
        if (c.paid && c.status === "succeeded")
          add(
            "payment",
            c.id,
            c.description || "Stripe payment",
            new Date(c.created * 1000).toISOString(),
            {
              amountMinor: c.amount,
              refundedMinor: c.amount_refunded || 0,
              currency: c.currency.toUpperCase(),
              email: c.billing_details?.email || c.receipt_email,
              customer: c.customer,
              paymentIntent: c.payment_intent,
              invoice: c.invoice,
              receiptUrl: c.receipt_url,
              sourceUrl: `https://dashboard.stripe.com/payments/${c.payment_intent || c.id}`,
            },
          );
      starting_after = r.has_more ? rows.at(-1)?.id : null;
      if (r.has_more && !starting_after)
        throw new IntegrationError("Stripe pagination incomplete.");
      if (starting_after) cursor(starting_after);
    } while (starting_after);
  }
  if (provider === "fathom") {
    let next;
    do {
      const r = await get("/meetings", {
        created_after: since,
        include_transcript: true,
        cursor: next,
      });
      for (const m of arr(r.items, "Fathom")) {
        let transcript = m.transcript;
        if (!transcript) {
          try {
            const t = await get(
              `/recordings/${encodeURIComponent(m.recording_id)}/transcript`,
            );
            transcript = t.transcript;
          } catch {
            warnings.push(
              `Transcript unavailable for recording ${m.recording_id}.`,
            );
          }
        }
        const segments = Array.isArray(transcript) ? transcript : [];
        add(
          "call",
          m.recording_id,
          m.title || m.meeting_title,
          m.recording_start_time || m.created_at,
          {
            stage: "closing",
            transcript: segments
              .map(
                (t) =>
                  `${t.timestamp || ""} ${t.speaker?.display_name || t.speaker || ""}: ${t.text || ""}`,
              )
              .join("\n"),
            segments,
            sourceUrl: m.share_url || m.url,
            participants: m.calendar_invitees || [],
            transcriptStatus: segments.length ? "available" : "unavailable",
          },
        );
      }
      next = r.next_cursor;
      if (next) cursor(next);
    } while (next);
  }
  if (provider === "wistia") {
    let page = 1;
    for (;;) {
      const rows = arr(
        await get("/medias.json", { per_page: 100, page }),
        "Wistia",
      );
      for (const m of rows) {
        let stats = null;
        try {
          stats = await get(`/stats/medias/${m.hashed_id}.json`, {
            start_date: since.slice(0, 10),
            end_date: new Date().toISOString().slice(0, 10),
          });
        } catch {
          warnings.push(`Engagement unavailable for ${m.hashed_id}.`);
        }
        add("video", m.hashed_id, m.name, m.created, {
          duration: m.duration,
          thumbnail: m.thumbnail?.url,
          stats,
          statsScope:
            "Provider media summary; do not assume a 90-day cohort unless confirmed by provider.",
          sourceUrl: `https://wistia.com/medias/${m.hashed_id}`,
        });
      }
      if (rows.length < 100) break;
      page++;
      cursor(String(page));
    }
    warnings.push(
      "Wistia library includes older videos so existing nurture resources remain available. Engagement is provider-reported, not revenue attribution.",
    );
  }
  if (provider === "ghl") {
    let startAfter, startAfterId;
    do {
      const r = await get("/opportunities/search", {
        location_id: accountId,
        limit: 100,
        startAfter,
        startAfterId,
      });
      for (const o of arr(r.opportunities, "GoHighLevel opportunities")) {
        if (
          o.createdAt &&
          Date.parse(o.createdAt) < Date.parse(since) &&
          o.status !== "open"
        )
          continue;
        add("opportunity", o.id, o.name, o.createdAt, {
          ...o,
          sourceUrl: `https://app.gohighlevel.com/v2/location/${accountId}/opportunities/list`,
        });
      }
      startAfter = r.meta?.startAfter;
      startAfterId = r.meta?.startAfterId;
      if (!r.meta?.nextPage) break;
      if (!startAfter || !startAfterId)
        throw new IntegrationError(
          "GoHighLevel opportunity pagination incomplete.",
        );
      cursor(`${startAfter}:${startAfterId}`);
    } while (true);
    let conversationAfter;
    seen.clear();
    for (;;) {
      const r = await get("/conversations/search", {
        locationId: accountId,
        limit: 100,
        startAfterDate: conversationAfter,
        sort: "desc",
        sortBy: "last_message_date",
      });
      const conversations = arr(r.conversations, "GoHighLevel conversations");
      let older = false;
      for (const c of conversations) {
        if (
          c.lastMessageDate &&
          new Date(c.lastMessageDate) < new Date(since)
        ) {
          older = true;
          continue;
        }
        let last;
        const messageCursors = new Set();
        do {
          const data = await get(`/conversations/${c.id}/messages`, {
            limit: 100,
            lastMessageId: last,
          });
          const envelope = data.messages?.messages ? data.messages : data;
          const ms = arr(envelope.messages, "GoHighLevel messages");
          for (const m of ms) {
            if (m.dateAdded && Date.parse(m.dateAdded) < Date.parse(since))
              continue;
            if (
              m.type === 1 ||
              m.type === "TYPE_CALL" ||
              m.messageType === "CALL"
            ) {
              let transcript = "";
              try {
                const t = await get(
                  `/conversations/locations/${accountId}/messages/${m.id}/transcription`,
                );
                const ts = Array.isArray(t)
                  ? t
                  : t.transcriptions || t.transcription || [t];
                transcript = Array.isArray(ts)
                  ? ts
                      .map((x) => `${x.startTime ?? ""} ${x.transcript || ""}`)
                      .join("\n")
                  : "";
              } catch {
                warnings.push(`Transcript unavailable for call ${m.id}.`);
              }
              add("call", m.id, "Setting call", m.dateAdded, {
                stage: "setting",
                contactId: c.contactId,
                transcript,
                transcriptStatus: transcript ? "available" : "unavailable",
                sourceUrl: `https://app.gohighlevel.com/v2/location/${accountId}/conversations/conversations/${c.id}`,
                recordingAvailable: !!m.attachments?.length,
              });
            } else if (m.body)
              add(
                "message",
                m.id,
                m.subject || m.messageType || "CRM message",
                m.dateAdded,
                {
                  body: m.body,
                  contactId: c.contactId,
                  direction: m.direction,
                  type: m.messageType,
                  sourceUrl: `https://app.gohighlevel.com/v2/location/${accountId}/conversations/conversations/${c.id}`,
                },
              );
          }
          last = envelope.nextPage ? envelope.lastMessageId : null;
          if (envelope.nextPage && !last)
            throw new IntegrationError(
              "GoHighLevel message pagination incomplete.",
            );
          if (last) {
            if (messageCursors.has(last))
              throw new IntegrationError(
                "GoHighLevel messages repeated a cursor.",
              );
            messageCursors.add(last);
          }
        } while (last);
      }
      if (conversations.length < 100 || older) break;
      const tail = conversations.at(-1);
      conversationAfter =
        tail?.sort ||
        (tail?.lastMessageDate
          ? new Date(tail.lastMessageDate).getTime()
          : null);
      if (
        !conversationAfter ||
        (typeof conversationAfter === "number" &&
          !Number.isFinite(conversationAfter))
      )
        throw new IntegrationError(
          "GoHighLevel conversation pagination omitted its date cursor. Previous data is preserved.",
        );
      cursor(JSON.stringify(conversationAfter));
    }
    warnings.push(
      "CRM opportunity inventory includes older open deals. Conversation history is limited to 90 days. Unsent workflow copy is not inferred from sent messages; upload a workflow export under Evidence.",
    );
  }
  return { records, warnings };
}
