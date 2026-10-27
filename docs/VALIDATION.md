# Local validation record

Validated on 27 October 2026 with Node 24 and Chromium. This records local results, not a published site or authenticated provider collection.

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
