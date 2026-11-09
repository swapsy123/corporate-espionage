# ScrapeCreators integration

Meta review links open with all countries, all ad categories and active/inactive ads selected (`country=ALL`, `ad_type=all`, `active_status=all`). This applies to advertiser matches, profile review and saved ad links when opened in the dashboard. The manual collection request remains scoped to active ads across all countries; Meta controls historical ad availability on its own site.

The server adapter uses the official public API contract distributed in `@scrapecreators/cli@1.0.87`, specifically its `api-config/apis.js`, `api-config/instagram-apis.js`, and transcript documentation. Package provenance: https://github.com/ScrapeCreators/scrapecreators-cli and https://www.npmjs.com/package/@scrapecreators/cli. No third-party wrapper is executed or installed as an application dependency. Source lookup used the npm registry because the onboarding machine's egress proxy denied access to the documentation site.

Every request is server-side to `https://api.scrapecreators.com`, with the `x-api-key` header taken from the authorized workspace's encrypted credential. The original Levr workspace alone can use the `SCRAPECREATORS_API_KEY` environment fallback. Redirects are rejected, timeouts and response size limits are enforced, and upstream response bodies are never surfaced as errors. The browser's masked setup field submits a key once; saved keys are never returned to the browser. Deployments behind an HTTP proxy should run Node 24 with `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` as appropriate to their platform.

## Account connection

The official CLI's account contract documents `GET /v1/account/credit-balance` with `x-api-key` and a numeric `creditCount` response. The server uses this endpoint to verify new keys before replacing an existing credential. A zero balance verifies identity but is shown with a prompt to add credits before collection. Requests have a 15-second timeout, reject redirects, and limit response size to 64 KiB.

`POST /api/settings/provider/verify` checks an already saved key. Authentication, CSRF and workspace authorization apply to both connection routes. Status polling never calls ScrapeCreators. Client verification timestamps persist inside the authenticated encrypted credential envelope; legacy version-1 envelopes remain readable until verified and rewritten as version 2. Failed verification preserves existing credentials and research.

The account/sign-in link `https://app.scrapecreators.com` is documented by the official CLI README. The setup guide's images are actual Levr interface screenshots with isolated fixtures. ScrapeCreators website access was blocked by this environment's proxy, so the external account/key steps use text rather than unverified third-party screenshots.

## Confirmed source identifiers

- Instagram: a handle or public profile URL.
- YouTube: a handle, `UC…` channel ID, or standard `/@handle` or `/channel/…` URL.
- Meta: a numeric Page ID or Ad Library URL containing `view_all_page_id`. Names are not accepted as confirmed identities. `searchMetaCompanies` can return explicit unconfirmed candidates from the official company search endpoint.

No collection request runs until `confirmed` is true. Source confirmation is a user's review of identity, not evidence that the provider has successfully retrieved it.

## Collection and pagination

| Content | Endpoint | Pagination |
| --- | --- | --- |
| All active Meta ads | POST `/v1/facebook/adLibrary/company/ads` with `pageId`, `status: ACTIVE`, `country: ALL` | Follow every `cursor` until exhaustion; no ad/page cap |
| Recent Instagram posts, Reels, and carousels | GET `/v2/instagram/user/posts` with `handle` | `next_max_id`; newest three pages by default |
| Recent YouTube Shorts | GET `/v1/youtube/channel/shorts` with `handle` or `channelId`, `sort: newest` | `continuationToken`; newest three pages |
| Recent YouTube videos | GET `/v1/youtube/channel-videos` with `handle` or `channelId`, `sort: latest` | `continuationToken`; newest three pages |
| YouTube detail enrichment | GET `/v1/youtube/video` with original URL | One per video |

`LEVR_ORGANIC_PAGE_LIMIT` may set the organic window between 1 and 100 pages per stream. The result includes `window` and `paginationExhausted`, so a bounded recent window is not represented as an exhaustive creator archive. Pinned Instagram content can appear within the newest timeline pages; timestamps remain the provider's actual timestamps.

Returned records are deduplicated by platform plus external identity; Meta uses `ad_archive_id`, never collation/campaign IDs. Parent persistence applies durable uniqueness and preserves previously stored content when a page request fails. Malformed collections and repeated cursors throw rather than pretending that a partial or empty result is complete. No automatic scheduling exists.

YouTube Shorts classification comes from the dedicated Shorts endpoint, not duration. Instagram's carousel slides preserve their individual image/video URLs. YouTube renders through `youtube-nocookie.com` embeds; media URLs may expire and need a later manual refresh. Private/deleted/age-restricted resources are not bypassed.

## Transcripts and metrics

- Meta: `/v1/facebook/adLibrary/ad/transcript`; `data.transcript`.
- Instagram: `/v2/instagram/media/transcript`; `transcripts[].text`.
- YouTube: `/v1/youtube/video/transcript`; `transcript_only_text` or timestamped segments.

Only returned transcripts are stored. A failed or empty transcription leaves the content record with `transcriptStatus: unavailable` and a sanitized error where present. Transcript failures are returned in refresh warnings; a transcript failure does not discard a usable ad/post. Meta and Instagram transcription may be speech-to-text provided by ScrapeCreators; YouTube uses public captions. No generative model fills missing transcript text.

The adapter does not enable `allow_long_transcription`. According to the current official contract, ordinary Meta/Instagram AI transcription covers up to 120 seconds at standard per-request pricing; longer AI transcription needs a separately enabled higher-cost provider mode. Long YouTube videos remain eligible for native public captions. If a long video has no available transcript, its creative and public metrics remain useful and visible as such.

Missing dates/engagement metrics remain null. Total engagement sums only available likes, comments, and shares; it does not treat unknown metrics as observed zero. Instagram views use Instagram-only plays where supplied and exclude combined Facebook plays. Paid ads expose no inferred spend, conversion, profitability, or ROAS values.

## Validation status

Fifteen provider tests exercise official response shapes with isolated fixtures: all-page Meta pagination/deduplication, timestamps, media/carousels, transcripts, distinct YouTube formats, missing metrics, bounded organic windows, failure preservation at the adapter boundary, safe error messages, confirmation gates, company candidates, missing active-state protection, and Shorts identity precedence when feeds overlap. These are contract tests, not a claim of live provider validation.

Live collection is blocked until the owner supplies `SCRAPECREATORS_API_KEY` securely and the environment permits `api.scrapecreators.com`. The current onboarding machine returned proxy `403 CONNECT` responses for the API and docs domains. Retry after configuration is applied. Never put the API key in chat or commit it.

Current onboarding connectivity check: the API endpoint is reachable through the managed proxy with `NODE_USE_ENV_PROXY=1`; it returns HTTP 401 without credentials. Authenticated live collection is still unverified because `SCRAPECREATORS_API_KEY` has not been supplied.

## Private media playback and manual repair — 9 November 2026

The free app now includes the authenticated video relay and queued image relay. It streams byte ranges for playback/seeking and retains complete media copies privately beside the persistent SQLite database. Cache hits still require workspace access. Stored source URLs, allowed CDN hosts, public DNS addresses and redirects are validated; no credentials are forwarded to media hosts.

**Repair failed previews** / **Refresh media for N posts** manually renews up to 50 Instagram posts, using the selected workspace's ScrapeCreators credits. Successful renewals preserve captions, transcripts, metrics and opportunities; failed renewals preserve previous creative data. Progress and per-post failures are visible and refresh history records each attempt. There is no cron or automatic paid-provider request on page load.

The free app cache is limited to 128 MiB per workspace and 384 MiB total (the Render blueprint provisions a 1 GB disk). Images are capped at 8 MiB; complete video copies at 128 MiB. This is an evictable cache, not a permanent archive. Manual renewal remains necessary when an uncached source expires. Account deletion removes cached copies for exclusively owned workspaces and prevents pending writes from restoring them; shared workspace media remains private to its members.

No new database migration, API key or hosting service is required. Render's blueprint has `autoDeploy: false`: deploy the latest main commit manually.

## Media diagnostics — 9 November 2026

Creative details now offer **Check media**, then **Copy media check**. This uses the same authenticated workspace-scoped image/video routes as the viewer, with a diagnostic query flag. Image checks validate bytes; video checks request the initial byte range and close the stream after bytes arrive. No ScrapeCreators calls or automatic source refresh occur. The check identifies upstream denial/missing/rate limiting, unsupported MIME types, DNS failures, timeouts, missing stored media and browser playback state. Reports include a revision marker and deployment commit when supplied by the host. They omit signed URLs, response bodies, cookies, keys and raw errors. Invalid/foreign workspace access cannot initiate a download.

YouTube embeds explicitly send an origin referrer using `strict-origin-when-cross-origin`; the rest of the app keeps its existing referrer policy. This addresses YouTube's identification requirement, but embedding can still be disabled by the original creator.

Live source playback remains unverified: this execution environment cannot reach the hosted app through its outbound proxy or access owner sessions/hosting logs. Browser tests use actual generated PNG/MP4 bytes and a simulated CDN; they do not establish that a particular production provider response is accessible. After deploying, open one affected creative, run **Check media**, and copy the report if playback still fails. Do not send API keys or signed source URLs.

## Paid-ad media renewal — 9 November 2026

Both research libraries now expose manual preview repair. Paid-ad details offer **Refresh media links**; the paid library offers **Repair failed previews** or **Refresh media for N ads**, up to 50 records at a time. These actions use the current workspace's ScrapeCreators key and credits. They fetch `/v1/facebook/adLibrary/ad?id=<stored archive ID>&get_transcript=false` and require the documented `adArchiveID` to match the stored identity. Missing media, incomplete variants or mismatched identities preserve the previous files and report failure. Ad age, activity, copy, transcripts, observations and saved opportunities are not changed by media renewal. This is public competitor-ad retrieval; it does not require access to the advertiser's Meta account. Owned-ad refresh in ARPRA continues to use its existing connected account integration.

Media normalization now validates each candidate URL before selecting it, so an invalid original/HD field cannot hide a valid resized/SD alternative. String entries in video arrays remain videos. Collection refreshes that omit all usable media retain the previously saved media, thumbnail and format instead of wiping the preview; a warning describes that retention. Exact media repair clears that warning after retrieving fresh media.

The provider response contract was checked against the official `@scrapecreators/cli` 1.0.87 Ad Details example. Automated tests cover the camel-case detail identity, single/batch paid-ad renewal, access denial across workspaces, preserved research, invalid fallback fields and incomplete refreshes. Chromium tests recover an expired video ad with single renewal and an expired image ad with batch repair, then verify decoded images, real MP4 playback/seeking and mobile layout. Upstream/CDN responses in these tests are simulated; production access remains unverified. Use **Check media → Copy media check** on a broken live item after deployment to distinguish expiry, upstream denial, unsupported files and browser playback failure. Never paste API keys or signed media URLs.

## Media retained across visits — 9 November 2026

A normal manual competitor refresh now saves available images and complete videos as part of the collection job, including creatives that have never been opened. Thumbnails/slides are saved before full movies, with at most four image workers or two video workers per collected group. Refresh completion waits for these writes and records a warning when files cannot be retained. This downloads already-returned CDN files; it adds no ScrapeCreators API calls, login refresh, or cron.

An authorized background save can finish after sign-out. Current authenticated access is still required to serve bytes; revoked membership, disabled clients and deleted workspaces stop background writes. A new login is therefore independent of the session that collected a file.

Cache identity now includes workspace, record, media type and the actual asset identity. Only known Meta/Instagram CDN signing and routing parameters are excluded; file paths, transforms, encoding parameters and unknown parameters remain significant. CDN edge rotation can reuse the same private copy, while different creatives and transforms cannot. Existing exact-URL cache entries upgrade in place when read, without another download.

Storage limits remain unchanged. Under quota pressure videos are evicted before images, so a large movie cannot clear every thumbnail. A newly downloaded file that does not fit is reported as not retained rather than counted as saved. This is still a bounded cache, not an unlimited archive: files larger than the limit, evicted files, unavailable upstream sources and hosting-volume misconfiguration cannot be made permanent by a code change. Existing broken media with no retained copy may need one normal refresh after deployment. For a permanent archive of all videos, provision suitably sized durable media storage.

Validation now includes a fresh return visit: normal collection before viewing any media, logout, process restart, new login, rotated signed URLs and a simulated unavailable CDN. Images render and actual MP4 video plays/seeks on desktop and mobile, without a media-repair action or another provider request. Production hosting storage and live source responses remain unverified from this execution environment.
