// Server-only delivery to the owner's GHL inbound webhook.
// A stable event ID supports downstream deduplication after an uncertain retry.
const timestamp = () => new Date().toISOString();
function webhookConfig(raw) {
  if (!raw) return { configured: false, provider: null, error: 'Add LEVR_SIGNUP_WEBHOOK_URL in the free service’s secure environment settings.' };
  let url;
  try { url = new URL(raw); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    return { configured: false, provider: null, error: 'Use a valid HTTPS GHL inbound webhook URL.' };
  const provider = url.hostname === 'services.leadconnectorhq.com' && /^\/hooks\/[^/]+\/webhook-trigger\/[^/]+\/?$/.test(url.pathname) ? 'GoHighLevel' : null;
  if (!provider) return { configured: false, provider: null, error: 'Use the GHL inbound webhook endpoint for this form.' };
  return { configured: true, provider, url: url.href, error: null };
}
export function createLeadDelivery(db, {
  webhookUrl = process.env.LEVR_SIGNUP_WEBHOOK_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = webhookConfig(webhookUrl), jobs = new Map();
  let queue = Promise.resolve();
  db.prepare("UPDATE signup_leads SET delivery_status='failed',last_error=? WHERE delivery_status='sending'")
    .run('Delivery was interrupted by a restart. Review and retry this lead.');
  const status = () => ({ configured: config.configured, provider: config.provider, error: config.error,
    counts: Object.fromEntries(db.prepare('SELECT delivery_status,count(*) n FROM signup_leads GROUP BY delivery_status').all().map(r => [r.delivery_status,r.n])) });
  function schedule(id) {
    const row = db.prepare('SELECT * FROM signup_leads WHERE id=?').get(id);
    if (!row) return { queued: false, error: 'Lead not found.' };
    if (jobs.has(id) || row.delivery_status === 'sending') return { queued: false, error: 'This lead is already being delivered.' };
    if (row.delivery_status === 'delivered') return { queued: false, error: 'The webhook already accepted this lead. Check its workflow execution in the destination.' };
    if (!config.configured) {
      db.prepare("UPDATE signup_leads SET delivery_status='unconfigured',last_error=? WHERE id=?").run(config.error,id);
      return { queued: false, error: config.error };
    }
    // Persist before sending. A crash remains visible and can be retried manually.
    db.prepare("UPDATE signup_leads SET delivery_status='pending',last_error=NULL WHERE id=?").run(id);
    const job = queue.then(async () => {
      const current = db.prepare('SELECT payload FROM signup_leads WHERE id=?').get(id);
      if (!current) return;
      db.prepare("UPDATE signup_leads SET delivery_status='sending',attempts=attempts+1,last_attempt_at=?,last_error=NULL WHERE id=?").run(timestamp(),id);
      let error = null;
      try {
        const response = await fetchImpl(config.url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Levr-Event-Id': id },
          body: current.payload,
        });
        if (!response.ok) {
          error = response.status === 429
            ? 'The webhook rate limit was reached. Retry later.'
            : `The webhook returned HTTP ${response.status}. Check the saved endpoint and destination workflow, then retry.`;
        }
        // Never log or surface a webhook's response body or secret URL.
        try { await response.body?.cancel(); } catch {}
      } catch { error = 'The webhook could not be reached or timed out. The lead is saved; check the destination before retrying.'; }
      if (error) db.prepare("UPDATE signup_leads SET delivery_status='failed',last_error=? WHERE id=?").run(error,id);
      else db.prepare("UPDATE signup_leads SET delivery_status='delivered',delivered_at=?,last_error=NULL WHERE id=?").run(timestamp(),id);
    }).catch(() => {
      // A delivery failure must never become an unhandled rejection or expose payloads.
      db.prepare("UPDATE signup_leads SET delivery_status='failed',last_error=? WHERE id=?")
        .run('Delivery could not be completed. The signup is saved; retry from the lead list.',id);
    }).finally(() => jobs.delete(id));
    jobs.set(id,job);
    queue = job;
    return { queued: true };
  }
  function registerRoutes(app) {
    const owner = (req,res,next) => req.user.role === 'owner' ? next() : res.status(403).json({error:'Only the Levr owner can manage signup leads.'});
    app.get('/api/signup-leads/status',owner,(req,res)=>res.json(status()));
    app.get('/api/signup-leads',owner,(req,res)=>{
      const page = Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1));
      const limit = 50, offset = (page-1)*limit;
      const rows = db.prepare('SELECT * FROM signup_leads ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(limit,offset);
      const total = db.prepare('SELECT count(*) n FROM signup_leads').get().n;
      res.json({ page,total,hasMore:offset+rows.length<total,leads:rows.map(row=>({
        id:row.id,workspaceId:row.workspace_id,email:row.email,details:JSON.parse(row.payload),
        createdAt:row.created_at,deliveryStatus:row.delivery_status,attempts:row.attempts,
        lastAttemptAt:row.last_attempt_at,deliveredAt:row.delivered_at,error:row.last_error,
      })) });
    });
    app.post('/api/signup-leads/:id/retry',owner,(req,res)=>{
      if (!db.prepare('SELECT 1 FROM signup_leads WHERE id=?').get(req.params.id)) return res.status(404).json({error:'Lead not found.'});
      const result = schedule(req.params.id);
      res.status(result.queued?202:409).json(result.queued?{queued:true}:{error:result.error});
    });
  }
  return { status,schedule,registerRoutes,wait:()=>queue };
}
