# Local validation record

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
