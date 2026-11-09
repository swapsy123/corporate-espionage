# Paid-ad media repair — 9 November 2026

- Production build passed; 134 Node tests passed (provider, refresh, retention, security and existing workflows).
- Real-byte Chromium media tests passed with single video-ad repair and batch image-ad repair in the paid library, plus existing organic playback/cache, carousel and mobile checks. ARPRA also passed owned-ad, uploaded-media and Fathom checks.
- Readable mobile paid-library screenshots were inspected. No production records, keys or credits were used.
- The live failure remains unverified without an authenticated media check from the hosted app. This change addresses confirmed code gaps, not a claim that every live source is available.
- No schema or secret changes. The free Render blueprint still has automatic deployment disabled.

# Media playback and diagnostic validation — 9 November 2026

- Production build passed; 130 Node tests passed, including cache/range behavior, concurrency, manual repairs, source preservation, scoped diagnostics and account deletion with cached media.
- `npm run test:media:browser` passed: relayed images, fallback/retry, carousel order, source links, saved opportunities, media renewal and desktop/mobile layout.
- `npm run test:playback:browser` passed with generated PNG/MP4 files: real video play/seek, single/batch repair, cached playback after simulated CDN expiry, carousel pixels, YouTube iframe referrer, safe media checks and mobile layout. Requires ffmpeg and Chromium.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` passed all eight desktop/mobile research routes and their save/brief/citation workflows.
- No production account, provider key or customer database was used. Real production CDN access remains unverified. Deploy and use the in-app Check media report on an affected item if playback remains unavailable.

# Local validation record

## Levr thumbnail and icons — 8 November 2026

- Added a static 1200×630 sharing thumbnail, an SVG browser icon, a 32px PNG fallback and a 180px Apple touch icon. They use the existing Inter Tight font and Levr paper/ink/rust tokens; no private workspace data appears in them. Assets were visually inspected.
- Open Graph and large-image card metadata are available in the initial HTML, with an absolute image URL for the free Render service. The existing `noindex,nofollow` directive remains. Docker now includes `public` during the Vite build so the images are packaged there as well.
- The production build passes. An isolated running server returned the expected metadata on `/`, `/signup` and `/paid`, served all four assets anonymously with correct media types/dimensions, and continued to return 401 for signed-out research API requests. Live social-crawler behavior has not been verified; Render needs manual deployment.
- Regenerate images with `CHROMIUM_PATH=/usr/bin/chromium node scripts/generate-brand-assets.mjs`. If the free service moves domains, update the absolute sharing-image URLs in `index.html`. Versioned image filenames allow future artwork updates without reusing old cache keys.

## Password length — 8 November 2026

- The free app now accepts passwords of 12–1024 characters, with a shared policy for signup, invitation acceptance, password reset and owner configuration. Existing passwords and hashes are retained. Sign-in no longer applies a password-creation minimum in the browser.
- New-password fields retain autofill support and expose a Safari-compatible `passwordrules` hint. Copy and current deployment/signup documentation use the same minimum. No password rotation, secret changes or database migration is needed.
- All 118 automated tests and the production build pass. Boundary tests reject 11 characters, accept 12, verify login and confirm that rejected invitation/reset attempts preserve links and sessions. The existing longer-password authentication tests continue to pass.
- Desktop/mobile signup and workspace browser workflows pass using randomly generated 12-character client passwords, including sign-in, invitations and password recovery. Chromium verifies the form hints; native Safari password generation was not exercised.

## Paid library gateway handling — 4 November 2026

- The reported “The server returned an unexpected response” message comes from the client JSON-decoding fallback and hides the response status. A non-JSON 502 reproduces it locally; the actual production status and cause remain unverified because this environment's proxy denies the live Render connection.
- Stored reads of `/api/items`, `/api/status` and `/api/competitors` now recover interrupted connections and non-JSON 502/503/504 responses with at most two additional attempts. Structured app errors are preserved without retrying. Refresh jobs, media renewal, provider-backed searches, signups and other mutations are never automatically repeated. Workspace changes stop queued retries and discard delayed responses.
- Invalid success responses reject cleanly instead of flowing into the page as data. Library errors identify the failed request and HTTP status, preserve already loaded cards, display an unavailable count rather than a false zero, and provide a button that retries stored reads only.
- All 116 automated tests and the production build pass. The focused browser regression simulates transient/persistent gateways, malformed HTTP 200 responses, independently failed status requests, retained cards after background failures and manual recovery. The eight-route desktop/mobile smoke and workspace browser workflow also pass, including delayed prior-workspace responses, password recovery and revoked sessions. A mobile error-state screenshot was inspected; no horizontal overflow or browser JavaScript errors occurred in those checks.
- Commands: `npm test`, `npm run build`, `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-library-errors.mjs`, `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-smoke.mjs`. The browser fixtures start no scraping jobs or paid provider calls. The server/database schema, credentials and ARPRA are unchanged. A sustained live gateway still requires the diagnostic steps in `docs/LIVE_RETRIEVAL_CHECK.md`; no production fix is claimed from simulated responses.

## Retrieval follow-up — 4 November 2026

- The user reports all Instagram previews unavailable and missing paid ads on the live free site. The live cause is not yet verified: this environment cannot inspect the signed-in Render service or use the workspace's provider key. See `docs/LIVE_RETRIEVAL_CHECK.md` for a browser-based diagnostic handoff.
- All 109 automated tests and the production build pass. The eight-route desktop/mobile browser smoke and dedicated media and refresh regressions pass. Tests use synthetic provider/CDN responses; no live retrieval is claimed.
- Meta profile connection and collection now share advertiser Page-ID parsing. An Ad Library URL with both `id` and `view_all_page_id` uses the advertiser ID; a single-ad URL is rejected. Collection still requests active ads across all countries, with a history warning when the provider returns no active ads. Existing numeric connections cannot be identified as wrong automatically and are not rewritten.
- Paid and organic libraries poll stored status/results while a manual competitor refresh is running, so newly collected items appear after completion without reopening the page. Polling makes no provider requests. Paid ads shows missing confirmed Meta connections and competitor refresh errors.
- A manual Instagram detail action retrieves that exact post through the documented `/v1/instagram/post` endpoint, checks returned identity and complete carousel media, and replaces only media links. It uses that workspace's key, retains caption/transcript/metrics/opportunity references, and records failures while preserving previous media. It does not enable the provider's additional-cost `download_media` option. Tests cover CSRF, workspace isolation, absent client keys, duplicate calls, session revocation and terminal history states.
- Browser checks verify successful fresh-link recovery, durable images after reload, failure preservation, source links, carousel navigation, 9:16 views and mobile layout. A mobile screenshot was inspected. The ordinary competitor refresh remains the way to renew recent content in bulk; the single-post action also works for older saved posts outside the recent timeline sample. Provider renewal cannot guarantee that a CDN or deleted original remains available.
- No schema or deployment-variable changes are required. Render still needs manual deployment; ARPRA is untouched.

## Meta review filters in the free app — 4 November 2026

- All 103 automated tests, the production build and the desktop/mobile browser smoke pass. The browser checks cover Meta profile review, search-result review and an ad with a previously stored source URL.
- Review links explicitly set `country=ALL`, `ad_type=all` and `active_status=all`, preserving the advertiser Page ID or individual ad ID. Meta profile review opens the advertiser's Ad Library page. Already stored source links are normalized at render time; no database rewrite or refresh is needed to correct their filters.
- Collection still requests active ads across all countries. Review filters do not change that collection scope or guarantee Meta retains every historical ad. The external Meta interface was not accessed in these local checks; outbound URL parameters were verified using fixtures.
- Render requires a manual deployment of the free app. Reopen review links from the refreshed app after deployment; an existing Meta tab retains its previous URL. The paid app is unchanged.

## Creative preview recovery — 4 November 2026

- All 103 automated tests and the production client build pass. The existing eight-route desktop/mobile browser smoke and the new `npm run test:media:browser` regression pass. No schema or secret changes are required.
- Instagram/Meta/YouTube CDN images can load through an authenticated endpoint scoped to the item's workspace. Tests verify signed-out denial, cross-workspace denial, client and owner access, revocation during a request, stored-source selection and preservation of research after failures. The relay rejects unsupported hosts, credentials, redirects outside the CDN allowlist, private addresses, oversized downloads and non-image responses. Requests forward no browser cookies, provider keys or referrers.
- Browser fixtures reproduce failed direct CDN requests and expired image URLs. Checks cover same-origin image delivery, alternate covers, clear unavailable states, manual retry, carousel slide navigation, saved opportunities, correct original links and 9:16 viewing. Desktop and 390/487px screenshots were inspected. No broken image elements, JavaScript errors or horizontal page overflow remained in the exercised cases.
- These tests use synthetic images and mocked CDN responses. The reported live post could not be inspected from this environment. Already expired media may require a manual competitor refresh; unavailable original media cannot be guaranteed recoverable. No background ScrapeCreators requests or refreshes were added.
- Render still requires manual deployment. The separate paid ARPRA repository is unchanged.

## Email/password only — 3 November 2026

- All 97 automated tests and the production client build pass. Google/Facebook authentication and deletion reauthentication have been retired; old provider credentials cannot re-enable them. No new migration or deployment variable is required.
- Obsolete provider signup tickets, OAuth states/challenges and deletion grants are invalidated at startup. Tests verify that existing accounts, memberships, identities and captured leads survive. A stale ticket cannot bypass password validation or mark an email as verified. Existing provider-linked accounts can use an owner-issued password reset without losing their workspace.
- Account deletion requires the current password even if a legacy provider grant exists. Historical Meta signed-request deletion remains tested; it is not a requirement to configure a new Meta app.
- Chromium signup and deletion workflows pass on desktop and mobile. Checks cover absent provider buttons despite configured test credentials, immediate private onboarding, password login/logout, lead retry, retained UTMs, retired callback guidance, typed deletion confirmation, cancellation, cleanup retry and session revocation. Signup screenshots were inspected; no JavaScript errors or horizontal overflow were observed.
- Commands: `npm test`, `npm run build`, `npm run test:signup:browser`, `npm run test:deletion:browser`. Provider responses and accounts are synthetic. The real GHL workflow still needs live field-mapping verification.
- This update still requires Render's manual deployment. It does not delete production test accounts, GHL contacts or hosting backups. ARPRA is unchanged. Earlier social-login checks below are historical and are superseded by this section.

## Account and lead deletion — 3 November 2026

- All 98 automated tests pass and the production client build passes. Additive migration 008 was inspected and tested against both the legacy owner database and an existing client/signup schema. Existing users, memberships, lead payloads, linked identities and research survive migration; SQLite integrity, foreign keys and migration repeatability pass.
- Deletion tests verify the account cascade, matching invitations and incomplete social signups, session revocation, exclusively owned database/sidecar/key removal (including interrupted-write ciphertext), owner protection, shared workspace preservation, role/CSRF enforcement, typed-email confirmation, idempotency and transaction rollback before any filesystem change.
- Failed file cleanup records sanitized retry state after catalog commit. Recovery works both through the owner API and after reopening the catalog in a new service instance. Queued/active webhook requests, refreshes, credential verification and OAuth responses cannot recreate removed account/workspace records. Revoked clients cannot finish replacing a key in a retained shared workspace.
- Provider confirmation tests use mocks and verify linked identity, initiating-session binding, expiry and final explicit deletion. Meta callback tests verify HMAC tampering rejection, opaque confirmations for matching/unknown identities, incomplete-signup removal, honest pending status during file-cleanup failure and protection of later registrations against replayed requests.
- The setup-account command was tested against an isolated running server: preview changes nothing, apply removes only the four exact requested aliases, unrelated/unaliased accounts survive, and repetition is safe. It has not been run against production.
- Desktop/mobile Chromium deletion checks pass for password and Google/Facebook confirmation, typed owner confirmation, cancellation, cleanup retry, selected-workspace fallback and revoked sessions. Screenshots were inspected; no JavaScript errors or horizontal overflow were observed. The signup/UTM browser regression also passes.
- Commands: `npm test`, `npm run build`, `npm run test:deletion:browser`, `npm run test:signup:browser`. All accounts, secrets and external-provider responses used in these checks are synthetic.
- Render remains manually deployed. Live Meta registration/verification, real provider reauthentication and production test-account cleanup require the deployment/account-access steps in `docs/SIGNUP.md`. GHL contacts and hosting backups are not erased by local account deletion.

## Public free signup, social login and GHL lead capture — 2 November 2026

- All 80 automated tests and the production client build pass. Migrations 006 and 007 were inspected and tested on the legacy single-owner database; existing research and confirmed profiles remain unchanged.
- Email/password signup grants a new isolated workspace immediately. Tests cover personal email addresses, role/workspace spoofing, duplicate and reserved emails, input validation, rate limiting, request origin protection, and owner-only lead access.
- Google and Facebook flows use mocked provider responses. Checks cover browser-bound single-use OAuth state, Google's PKCE and verified-email requirement, Facebook's missing-email case, denied disabled accounts, and refusal to silently link an existing password account by email. Tokens and secrets are excluded from lead records and responses.
- GHL delivery is mocked. Failed requests preserve both access and captured lead data; owner retry retains the exact event ID, consent and UTM payload. Unsupported webhook destinations are rejected. “Webhook accepted” represents transport acceptance only.
- All five UTM fields survive a tagged landing page, untagged navigation, and Google/Facebook redirects. Tests check replacement by a new campaign, expiry, malformed/blocked browser storage, exclusion of unrelated URL parameters, clearing after signup, owner readback and delivery to the webhook payload.
- The isolated Chromium signup workflow passes for email, Google and Facebook, immediate Workspace settings, private data boundaries, manual lead retry and mobile overflow. Desktop and mobile screenshots were inspected; no browser JavaScript errors were observed.
- Run `npm test`, `npm run build`, and `npm run test:signup:browser` (set `CHROMIUM_PATH` if needed). No real customer accounts or provider credentials are used by these checks.
- Live Render deployment, the real GHL workflow's field mapping, and actual Google/Facebook app configuration remain unverified. Set secrets securely and complete the live acceptance checklist in `docs/SIGNUP.md`; local mocks do not establish a working live integration.

## Guided account setup — 28 October 2026

- All 70 automated tests pass; the production client build passes. No SQL migration or new deployment variable is required for this update.
- Invitation acceptance opens Workspace settings for the accepted workspace, including existing clients joining another workspace. Password-reset navigation remains unchanged.
- The isolated Chromium workspace workflow verifies the sign-in link and image assets, mobile layout, rejected-key errors, persistent dismissal after a verified connection, restoration after key removal, and the continuation to competitor setup. No JavaScript errors or horizontal overflow were observed.
- Server tests verify the documented account-balance request, zero-credit accounts, sanitized rejected/malformed/unreachable responses, authentication and workspace boundaries, preservation of prior credentials on failure, and no provider requests during status polling. Version-1 encrypted keys remain readable; version-2 verification metadata persists encrypted.
- Two actual Levr interface screenshots were captured and inspected. Their synthetic fixture provenance and regeneration script are recorded in `docs/SETUP_SCREENSHOTS.md`. ScrapeCreators account/dashboard screenshots could not be captured because the environment proxy denied website access. The external steps use text and the official account link, without fabricated screenshots.
- Account API and account-link contracts were checked against the official ScrapeCreators CLI package. Live authenticated account verification and deployment remain unverified; publishing still requires Render's manual deployment flow.

## Client workspaces — 28 October 2026

The existing site is hosted at `https://levr-competitor-analysis.onrender.com`; the owner has confirmed sign-in and competitor refresh work. The client-workspace update below is locally validated and requires a Render Blueprint **Manual Sync** to apply the new encryption setting and deploy. It has not yet been verified on the hosted service.

- All 64 automated tests pass with Node 24. The production client build passes.
- The legacy single-owner database upgrades through migrations 004 and 005 with existing competitors, profile confirmations, items, opportunities, boards, briefs, and refresh history unchanged. SQLite integrity and migration repeatability pass.
- Workspace tests cover owner access to every workspace, client membership enforcement, foreign workspace headers and record IDs, isolated research and citations, independent concurrent refresh jobs and provider keys, and persistence across reopening separate database files.
- Client refreshes fail without that client's configured account; they never fall back to Levr's account. Keys are saved only in authenticated encrypted files outside SQLite. Tests cover filesystem permissions, tampering, wrong encryption keys, file relocation, symlinks, and preserving a prior key after a rejected replacement.
- Invitation and recovery tests cover email binding, expiration, one-time use, purpose separation, CSRF, owner-only management, password hashes, session revocation, and permanent revocation of pending reset links when membership is removed.
- Desktop/mobile Chromium smoke and refresh regressions pass. The workspace browser workflow covers workspace creation, invitation acceptance, masked key setup, owner switching, discarded delayed responses from the prior workspace, rejected foreign workspace access, password recovery, and member revocation. No browser JavaScript errors or horizontal overflow were observed; screenshots were inspected.
- Tests use isolated synthetic fixtures and randomly generated test credentials. They do not validate an actual client's provider account, credits, or live collection. That check requires the client to connect their key and manually refresh a confirmed profile after deployment.

Commands: `npm test`, `npm run db:migrate`, `npm run build`, `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-smoke.mjs`, `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-refresh.mjs`, and `CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-workspaces.mjs`.

## Initial implementation — historical record

Validated on 27 October 2026 with Node 24 and Chromium. The following records the initial local results before deployment.

- Frozen installation (`npm ci`), both SQL migrations, SQLite integrity check, and production client build passed.
- 35 automated tests passed: owner authentication, CSRF and unauthorized requests; candidate profile confirmation; manual refresh and duplicate rejection; Meta ad-ID deduplication; failed/malformed refresh preservation; all five organic rankings; missing metrics/transcripts; opportunities, tags, ratings and every stage; library/board patterns; four brief formats and saved readback; citations resolving to stored items; SQLite reopen persistence; safe provider failures and pagination.
- Chromium smoke checks passed for all eight desktop/mobile routes, sign-in, paid and organic saves, stage changes, brief generation, clickable Ask citations, vertical Reels/Shorts, horizontal long-form, carousel navigation, and mobile navigation. No JavaScript errors or horizontal overflow were observed. Screenshots were inspected.
- Browser and automated checks use isolated synthetic fixtures, never the working research database. Fixtures establish application behavior, not provider access or actual competitor data.
- Provider endpoint connectivity succeeded; without an API key the authenticated endpoint returned HTTP 401. Live collection, live original-media playback, and provider transcript quality remain unverified.
- Hosting account access, an owner password, and the ScrapeCreators key are still required. No deployed URL exists yet. Optional AI generation was tested with mocked responses; the built-in brief templates and evidence queries work without it.

To rerun: `npm test`, `npm run db:migrate`, `npm run build`, and `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser` on this machine. On another machine, point `CHROMIUM_PATH` to Chromium or install Playwright's supported browser.

## Production-mode installation correction

An isolated checkout reproduced a missing build dependency when `NODE_ENV=production npm ci` was followed by `npm run build`: Vite was omitted and the build failed. The corrected Render command `npm ci --include=dev && npm run build` passed under production settings. Startup against a fresh test database returned `/healthz` 200, `/` 200, and signed-out `/api/items` 401.

The owner supplied `https://levr-competitor-analysis.onrender.com` and reported a root-page 502. Direct live verification is blocked by the cloud workspace egress proxy; the production-build fix is verified locally, but its relationship to that live failure remains unconfirmed until Render logs or a successful redeployment are available.

## Confirmed-profile refresh correction

Bulk refresh previously queued every active competitor, including unconfirmed candidates, creating misleading confirmation errors. It now queues only competitors with confirmed profiles and reports how many candidates were skipped. A targeted migration clears that obsolete watchlist error while retaining historical sync records and all saved research.

Polling now preserves loaded cards and scroll position; it clears stale content when the actual query scope changes. Running refresh controls are disabled. Instagram normalization also accepts numeric provider IDs without throwing a string-method error.

Validation: 40 automated tests pass. The production build and existing full desktop/mobile browser smoke pass. A dedicated isolated browser regression (`CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-refresh.mjs`) verifies confirmed-only collection, stable card identity and scroll across progress polls, duplicate controls, successful completion, and clean format changes. This patch still requires deployment to the hosted service before its live behavior can be verified.
