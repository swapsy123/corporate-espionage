# ScrapeCreators integration

The server adapter uses the official public API contract distributed in `@scrapecreators/cli@1.0.87`, specifically its `api-config/apis.js`, `api-config/instagram-apis.js`, and transcript documentation. Package provenance: https://github.com/ScrapeCreators/scrapecreators-cli and https://www.npmjs.com/package/@scrapecreators/cli. No third-party wrapper is executed or installed as an application dependency. Source lookup used the npm registry because the onboarding machine's egress proxy denied access to the documentation site.

Every request is server-side to `https://api.scrapecreators.com`, with the `x-api-key` header taken from `SCRAPECREATORS_API_KEY`. Redirects are rejected, timeouts and response size limits are enforced, and upstream response bodies are never surfaced as errors. Store the key only in the deployment secret settings. No key is needed by the browser. Deployments behind an HTTP proxy should run Node 24 with `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` as appropriate to their platform.

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
