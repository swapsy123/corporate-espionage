# Levr Competitor Analysis

A private content-research workspace for Levr and its clients, covering active Meta ads, Instagram Reels/carousels/images, and separate YouTube Shorts and long-form rankings. The interface follows Levr's editorial system: Inter Tight, warm paper, near-black ink, square corners, hairline rules, and restrained rust emphasis.

## Development

Use Node 24. This cloud task already has an isolated checkout; use the existing repository rather than creating a Git worktree.

```sh
npm ci
npm run db:migrate
npm run build
npm test
npm start
```

Before starting, set `LEVR_OWNER_PASSWORD` to a unique value of at least 16 characters in secure environment settings. Set `SCRAPECREATORS_API_KEY` there for live collection. The platform owner is `fraser@wearelevr.com` unless the server-side `OWNER_EMAIL` setting is deliberately changed. Clients sign in with their invited email and a password they set themselves. `.env.example` documents the settings; no real credential belongs in a tracked file. The application does not automatically load `.env` files. For local development, Node's `--env-file` flag can load a separately created, ignored file; prefer injected settings in managed environments.

For hot reload, run `npm run dev` for the server and `npm run dev:ui` for the Vite interface in separate terminals. Build before running the standalone production server. The database defaults to `data/levr.sqlite`, which is ignored by Git.

## Workflow

1. Review candidate competitors and add the correct Meta Page ID, Instagram handle, or YouTube channel. Confirm each connection explicitly.
2. Refresh one competitor or use **Refresh confirmed competitors** to collect from all active, confirmed sources. Unconfirmed candidates are skipped. Progress updates keep the watchlist visible. There is no cron job. Prior records survive failed refreshes, and refresh history records actionable errors.
3. Explore the paid library sorted by ad duration and organic libraries ranked within each platform and format. Open a reference to inspect media, copy, transcripts when available, and original links.
4. Save references to the Creative Inbox or a custom Opportunity Lab board. Add notes, tags, ratings, and a workflow stage.
5. Find recurring patterns across the library or one board. Generate a brief with separately labeled source evidence and original adaptation, or ask the stored library a question with source citations.

The initial database contains competitor/profile candidates supplied by the owner, not fabricated ads or posts. Test fixtures are isolated from production data. Live collection cannot be verified until a valid ScrapeCreators key is configured and profile connections are confirmed.

## Research signals

Active-ad duration indicates observed durability; it does not prove profitability, spend, conversions, or ROAS. Organic outlier scores compare a post with other stored posts by the same creator on the same platform and in the same format. Sparse or zero baselines do not receive a fabricated score. Public metrics are incomplete, and missing counts remain unknown. A missing transcript remains labeled unavailable.

Pattern classifications are evidence-based heuristics. Source captions, transcripts, and original links remain available for review. Optional OpenAI access enriches original adaptations; factual evidence and citation targets come from stored records. Content gaps are research hypotheses, not proof of competitor intent or undiscovered demand.

## Validation and publication

Run `npm test`, `npm run db:migrate`, and `npm run build`. Review the generated schema in `server/migrations/`. Tests use isolated databases and fixtures; passing them does not establish live provider access or a deployed site.

See [deployment instructions](docs/DEPLOYMENT.md) for Render hosting, the persistent disk, private owner access, secure credential entry, and publication checks. `render.yaml` is a deployment blueprint; saving it creates no hosting account, service, or final URL.

## Private client workspaces

The owner can create client workspaces and generate invitation links under **Clients**. Share each link directly with its intended recipient. Invitations expire after seven days and are accepted once; there is no public registration or automatic email. The owner can revoke pending invites, remove members, and create one-hour password reset links. Existing client accounts use their current password to accept another workspace invitation.

Each client sees only assigned workspaces. The owner can switch into any client workspace. A new client workspace starts empty with its own Creative Inbox. Existing Levr research stays in the original database. Every client database is stored separately in the durable data directory, and every API request checks workspace membership.

Each client connects their own ScrapeCreators account under **Settings**. The field is masked and write-only; saved values are never returned to the browser. Keys are encrypted with AES-256-GCM in separate server files, never in the research databases. Clients never fall back to Levr’s provider key. Render creates `LEVR_SECRET_ENCRYPTION_KEY` when the updated blueprint is synced; keep this value stable. Review [deployment instructions](docs/DEPLOYMENT.md) before upgrading an existing service.

Additional validation: `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-workspaces.mjs` exercises invitation acceptance and workspace boundaries with isolated test accounts.
