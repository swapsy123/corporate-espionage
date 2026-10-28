# Levr Intelligence Beta

The invitation-only paid workspace for Levr clients. Deploy branch **paid-beta** to a **new service, URL, disk, database and credentials**. The free lead magnet stays on main. Never sync this blueprint into the existing free service.

## Included

- Private client workspaces, owner management, expiring invitations after payment is arranged, and client password setup. No public registration or checkout.
- Guided onboarding for one core offer, a brand kit, client photos and independent ScrapeCreators accounts. Includes a ChatGPT/Claude brand-kit prompt.
- Read-only Meta, GoHighLevel, Fathom, Wistia and Stripe connections. Manual 90-day imports, history, deduplication and preservation on failure. No cron or outbound marketing actions.
- Ad-level daily metrics, Meta-attributed ROAS, currency-separated Stripe collections/refunds, CRM outcomes and explicit manual payment-to-deal matching.
- Setting/closing call evidence, suggested objections, reviewed excerpts, custom boards and citations.
- Original campaign briefs using the supplied YappMaxxing, Belief Breaking Diamond and Hook–Proof–Value–CTA frameworks. Source evidence stays separate from adaptation. Levr approves; clients can view, edit and comment. Edits invalidate approval.
- Carousel Studio: branded text and editorial photo styles, original assets, slides, crops, captions, previews, comments and real 1080 × 1350 PNG exports. ZIPs contain a contact sheet, images-only archive and editable HTML/JSON.
- Original competitor management, paid-ad library, separate organic rankings, Opportunity Lab, Pattern Finder, research briefs and cited questions.
- Intelligence questions over imported evidence, public article import, pasted documents and consented audio/video transcription.

Production starts empty. Fixtures are confined to isolated tests. Live providers and external AI require valid account connections and are not verified by local tests.

## Development

Use Node 24 and Chromium. Inject settings from `.env.example` through secure runtime configuration. Use a unique owner password of at least 16 characters and stable encryption secret of at least 32 characters. The application does not load .env automatically; use Node's --env-file flag locally or managed hosting settings. Never use a VITE_ prefix for a credential.

```sh
npm ci
npm run db:migrate
npm run build
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:beta:browser
npm start
```

The default database is data/levr-beta.sqlite. For hot reload use npm run dev and npm run dev:ui. Docker installs Chromium and builds the interface. Keep one instance with durable local storage.

## Workflow

1. Sign in as fraser@wearelevr.com, create a workspace under Clients and share its invitation privately after arranging payment.
2. The client lands in Getting started, enters their core offer and brand kit, uploads photos and connects their own research account.
3. Levr connects the assigned Meta ad account and GHL subaccount. The client supplies Fathom, Wistia and Stripe read access. Select Import last 90 days manually.
4. Review evidence and confirm actual prospect objections. Suggestions are not verified loss reasons.
5. Generate a campaign from a board and selected sources. Resolve missing proof and approve as Levr. Create a carousel from its outline or write one directly.
6. Review every saved slide, approve the current revision and export. Draft export is available for review. The app does not publish posts or activate GHL workflows.

Read [deployment instructions](docs/DEPLOYMENT.md) and [provider coverage](docs/PROVIDERS.md). Uploaded editorial instructions are preserved under [docs/skills](docs/skills); client voice and verified evidence override their original personal-brand defaults.
