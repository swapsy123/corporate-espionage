# Provider coverage

Connections are read-only and workspace scoped. All imports are manual. The history window defaults to 90 days; account retention, recording settings, permissions and plans can reduce available history. Recordings that never existed cannot be reconstructed.

| Provider | Imported data | Boundaries |
| --- | --- | --- |
| Meta | Levr-managed ads_read OAuth/read token, daily ad insights, campaign/ad-set names, spend, impressions, link clicks, available conversion actions/values and creative metadata. | 7-day click / 1-day view attribution; account currency/timezone retained. Lead conversion rate is leads / landing-page views. Missing actions remain unknown. Original Ads Manager links remain available when media is inaccessible. No campaign changes. |
| GoHighLevel | Levr-managed client-location private integration token; location, opportunity, conversation and message read access. Opportunities, recent sent messages and available LC Phone setting-call transcripts. | Enable recording/transcription first. Missing transcripts remain unavailable. Conversation pagination uses a date cursor; messages use IDs. Unsent workflow bodies are not inferred: upload the actual copy/export as evidence. No messages, workflows or CRM mutations are sent. |
| Fathom | Client's API key; meetings and available speaker/timestamp transcripts. | Imported as closing calls. Review speaker/context before confirming objections. Plan/API access and retention apply. |
| Wistia | Client's token with media/statistics read access; video inventory and media statistics. | Older videos remain available for nurture research. Stats are labeled provider summaries, not a verified 90-day viewer cohort. Individual prospect identity and causal sales attribution are not implemented. |
| Stripe | Client's restricted server key with account and charges read access; successful charges, refunds, currency and payment IDs. | Collections are grouped by charge date with current refunds. This is not accounting net revenue: fees, disputes, taxes, payout timing and refunds of charges outside the window are not reconciled. GHL contract values are not added to cash. |
| ScrapeCreators | Client's API key; existing competitor collection adapters. | Confirm profiles before refresh. Public engagement and ad duration are research signals, not sales performance. |

Provider documentation: [Meta](https://developers.facebook.com/docs/marketing-apis/), [HighLevel](https://marketplace.gohighlevel.com/docs/), [Fathom](https://developers.fathom.ai/), [Wistia](https://docs.wistia.com/), [Stripe](https://docs.stripe.com/api), [ScrapeCreators](https://scrapecreators.com/).

GHL conversation/message/transcription contracts were checked against its published SDK. Fixtures exercise pagination and failure retention. Real provider responses have not been verified with client credentials here; complete DEPLOYMENT.md's live checks.

## Evidence and output limits

Manual payment-to-opportunity links record an explicit match, not advertising causation. Show/close rates use recorded outcomes for the selected opportunity cohort, excluding unknowns. Cancelled/rescheduled calls are excluded from the attended-versus-no-show denominator.

Objection suggestions use transcript keywords; they are not exhaustive semantic analysis or proven loss reasons. Confirm verbatim excerpts and speakers. Source instructions are content, not application commands. AI uses selected excerpts, so truncated or sparse sources cannot establish an exhaustive analysis of every client interaction.

Carousel duplicate checks use original-file hashes. Review visually identical re-exports, repeated crops, low resolution and text over faces manually. Overflow is checked during export; visual suitability requires Levr review. Supported fonts are Inter Tight, Arial, Georgia and Times New Roman; arbitrary font-file upload is not included.

Public article import accepts readable HTTPS pages, rejects private/reserved network destinations, and checks redirects. Social page titles are not transcripts. Upload actual transcripts or supported recordings when extraction is unavailable. Media uploads are capped at 24 MB, images at 20 MB. Uploaded-media transcription analyzes audio, not visual demonstrations.
