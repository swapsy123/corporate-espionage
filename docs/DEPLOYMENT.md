# Deploy the separate paid beta

**Do not sync the existing levr-competitor-analysis service or blueprint with this branch.** The free lead magnet stays on main. The paid-beta branch uses the same source repository but an independent service, URL, disk, database, secrets and session cookies. Free-app data is not copied.

## Create the service

1. In Render choose New → Blueprint. Select swapsy123/corporate-espionage, explicitly select branch **paid-beta**, and use its render.yaml.
2. Verify the new service is **levr-intelligence-beta** and its disk is **levr-beta-private-data**. Stop if Render proposes changing the free app.
3. Review Render's displayed charges. The blueprint requests one **Standard** instance and a **10 GB disk** for Chromium and uploads. This is proposed configuration, not a purchase made by this repository. Automatic deployments are off.
4. Enter a new LEVR_OWNER_PASSWORD through Render's secure form, at least 16 characters; save it in a password manager. Keep OWNER_EMAIL=fraser@wearelevr.com. Render generates a new LEVR_SECRET_ENCRYPTION_KEY. Preserve it securely; do not overwrite or reuse the free app's settings.
5. Enter LEVR_AI_API_KEY for an OpenAI account through secure settings. It powers original campaign generation, evidence answers and optional uploaded-media transcription. Without it, manual drafting and connected-source features remain available, but AI generation is unavailable.
6. Apply the new blueprint. Docker builds the interface, installs Chromium and starts Node on Render's assigned port. Keep DATABASE_PATH=/var/data/levr-beta.sqlite on the attached disk. NODE_ENV=production and TRUST_PROXY=1 are set for Render HTTPS.
7. Use the **new HTTPS URL shown by Render** when Live. A Git push or local build does not assign a URL. Sign-in and static interface pages are public; data endpoints require authenticated workspace membership.
8. Create a test client workspace and complete the live checks below before admitting paying clients.

GitHub/Render authorization, hosting charges and credentials require the owner's account access. No connected deployment session was available during implementation. Never paste credentials into chat or Git.

## Meta developer app

Create the app for Levr's business and obtain the permissions appropriate to its use. The application requests ads_read and does not modify campaigns. Meta may require business verification, app review or advanced access depending on the businesses and people connecting. Development-mode tester access is not production approval.

In the beta's secure environment settings add META_APP_ID, META_APP_SECRET and PUBLIC_BASE_URL (the beta HTTPS origin, without a path). Register this exact redirect in Meta:

```text
https://YOUR-BETA-HOST/oauth/meta/callback
```

Select the client workspace, enter its numeric ad-account ID and choose Connect with Meta as Levr. The callback checks expiring, single-use state tied to the owner session and workspace, verifies the ad account and encrypts the token. Reconnect after expiry or revoked access. A manually entered read token is also supported for controlled beta setup.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| LEVR_SECRET_ENCRYPTION_KEY | Stable master secret for AES-GCM credential files; back it up separately. Losing it requires restoration or reconnection. |
| LEVR_AI_MODEL | Optional text model, initially gpt-4.1-mini. Uploaded audio uses whisper-1. |
| META_API_VERSION | Pinned Graph API version, initially v23.0; review provider version support before changing. |
| CHROMIUM_PATH | Docker sets /usr/bin/chromium for deterministic slide rendering. |
| SCRAPECREATORS_API_KEY | Optional beta-owner research fallback. Clients always supply their own key in Workspace settings. |

Other provider keys are entered through masked, authenticated connection forms and verified before replacement. Secrets are encrypted outside SQL, never returned in API responses or embedded in browser bundles. Generation sends selected excerpts and offer information to OpenAI. Uploaded media transcription requires explicit confirmation. Only upload content authorized for this processing.

## Durable storage and recovery

- /var/data/levr-beta.sqlite: owner workspace, authentication catalog, memberships and invites.
- /var/data/workspaces/: separate client databases.
- /var/data/secrets/: encrypted ScrapeCreators credentials.
- /var/data/beta/credentials/: other provider-specific encrypted credentials.
- /var/data/beta/assets/: private original images and recordings per workspace.

All six versioned migrations run at startup and for new client databases. npm run db:migrate migrates the catalog and reports integrity. Interrupted imports become failed after restart; prior evidence remains. There are no cron jobs, automatic deletions or provider webhooks.

Keep one instance. Use a consistent disk snapshot or SQLite-aware backup with writes quiesced for the **whole durable directory**. Back up the encryption secret separately and restore-test both data and credentials. Copying a live WAL database alone can lose data. Monitor disk usage; 10 GB is not unlimited storage. Removing a member revokes access but does not erase research. Data erasure is an administrator maintenance task in this beta.

Deploy later tested paid-beta commits to this beta service only. Snapshot before migrations. Keep the disk, data path and encryption key stable. Roll back code only if the schema remains compatible; otherwise restore a matched snapshot and secret.

## Live launch checks

- Owner login, signed-out API rejection, invite redirect to Getting started, and cross-client 404 responses.
- Correct Meta account/GHL location; clients cannot reassign agency accounts or approve drafts.
- Each provider completes a real manual import. Compare counts, pagination, dates, currencies and source links with its dashboard. Confirm recordings/transcripts exist for the intended period.
- A revoked-key failure preserves prior evidence. Reconnect and retry. Credentials must not appear in UI, responses, SQL or logs.
- Reconcile Meta metrics with the configured attribution window and selected Stripe charges/refunds. Manual deal links do not establish ad-attributed cash ROAS.
- Review real setting/closing objections, generate an AI campaign, inspect citations, resolve proof gaps and approve as Levr.
- Client comments work, edits reset approval and stale revisions cannot be approved.
- Export both carousel styles with client photos. Inspect every PNG, contact sheet, caption, unique photo assignment, crop and phone-size readability.
- Restart and confirm data/credentials persist; confirm the separate free application still works.

Local build/API/browser checks do not establish live provider access or AI output quality. Deployment and account-specific checks must be completed with the owner's connections.
