# Paid beta validation

Local validation completed on 28 October 2026 using isolated databases, synthetic provider responses and temporary credentials. No live client data was imported or seeded.

| Check | Result |
| --- | --- |
| Production Vite build | Passed |
| Full Node test suite | 82 passed, 0 failed |
| Six SQL migrations | Applied; integrity check OK; no foreign-key errors |
| Beta browser workflow | Nine pages on desktop/mobile; offer/brand save; source upload; objection confirmation; campaign draft, approval, comment and revision reset; private image previews; both carousel styles exported as real PNG ZIPs |
| Competitor browser workflow | Eight research pages; ad/post saving; stage moves; brief generation; working citations; 9:16 Reels/Shorts; horizontal long-form video; carousel slide navigation |
| Client browser workflow | Invite acceptance and onboarding; working setup screenshots/link; verified guide dismissal; failed-key retention; isolated workspaces; stale-response protection; password recovery; access revocation |
| Docker build | Passed with Node 24 and Chromium. This cloud environment required its proxy CA as an ephemeral BuildKit secret; TLS verification remained enabled. Render does not need that local CA setting. |
| Beta tests inside Docker | 12 passed, 0 failed, including a real Chromium export |
| Production container startup/restart | Healthy; signed-out API returns 401; secure beta session cookie; unprivileged UID; saved record survives restart on an isolated named volume |

The source free-app checkout and remote main branch remained at ad8b044 during these checks. The paid release uses its own branch and deployment blueprint.

Provider and AI fixtures verify application behavior, not real account access or model output quality. A hosted beta URL, Meta app review/permissions, real provider imports and account-specific metric reconciliation still require the separate deployment and credentials. Follow the launch checks in DEPLOYMENT.md before admitting live clients.
