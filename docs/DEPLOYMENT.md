# Private deployment

Levr Competitor Analysis uses a single Node 24 server and a SQLite database on persistent storage. Render's paid web service with an attached disk is the recommended initial host. The application requires owner authentication for its intelligence data and mutations. The sign-in page and static interface assets are publicly reachable; this is application-level privacy, not a private network service.

No hosting resources have been provisioned by the repository files. Creating a Render account, connecting GitHub, accepting the service price, and entering secrets require the owner's account access. Cloud development-environment publication does not publish this website.

## Create the service

1. Create or sign in to a Render account. Connect the private GitHub repository containing this project and authorize access to that repository only.
2. Choose **New → Blueprint** and select the repository and branch containing `render.yaml`.
3. Review the web-service and persistent-disk costs shown by Render before creating resources. The blueprint requests one `starter` instance and a 1 GB disk; it does not create a cron job or multiple instances.
4. In Render's secure environment settings, enter `LEVR_OWNER_PASSWORD` (a unique password of at least 16 characters) and `SCRAPECREATORS_API_KEY`. Do not send these in chat or commit them. Keep `OWNER_EMAIL=fraser@wearelevr.com`.
5. Apply the blueprint. Render runs `npm ci --include=dev && npm run build`, then `npm start`. `DATABASE_PATH=/var/data/levr.sqlite` must remain on the attached disk. Keep `NODE_ENV=production` so session cookies require HTTPS.
6. Once the health check passes, use the HTTPS service URL supplied by Render. Sign in as the owner. Verify the signed-out API rejects requests, confirm the correct competitor profiles, then manually refresh one competitor before refreshing all.

A successful build or `/healthz` response alone does not verify data collection. Live verification requires a configured ScrapeCreators account with sufficient credits, confirmed profile identifiers, and working network access.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAIL` | Sole owner login; default `fraser@wearelevr.com`. |
| `LEVR_OWNER_PASSWORD` | Owner-only authentication secret; minimum 16 characters. Enter through secure runtime settings. There is no public sign-up. |
| `SCRAPECREATORS_API_KEY` | Server-side key sent only to `api.scrapecreators.com`. Required for live collection. |
| `LEVR_AI_API_KEY` | Optional server-side OpenAI key for richer original creative adaptations. Evidence-backed analysis and structured briefs also work without it. |
| `DATABASE_PATH` | SQLite file on a durable disk; `/var/data/levr.sqlite` on Render. |
| `NODE_ENV` | Set to `production` on an HTTPS deployment. |
| `PORT` | Supplied by Render. Defaults to the application's local port otherwise. |
| `TRUST_PROXY` | Blueprint sets `1` for Render's reverse proxy, so sign-in rate limits use the forwarded client address. Leave unset when serving directly; change only to match your actual proxy topology. |

Optional AI integration sends selected stored source material and the requested brief context to OpenAI. It does not send the ScrapeCreators credential. Keep AI credentials outside source control and client bundles; never use a `VITE_` prefix for secrets.

The local cloud environment's secret-proxy bindings do not automatically configure Render. Add the actual credentials separately through Render's secure settings. ScrapeCreators collection needs HTTPS access to `api.scrapecreators.com`; optional AI needs `api.openai.com`. Source media viewers access the original provider/CDN URLs in the browser and may depend on provider availability or expiring media URLs.

## Durable data and maintenance

The application applies versioned SQL migrations at startup. `npm run db:migrate` applies the same migrations and runs an integrity check explicitly. A restart retains competitors, references, opportunities, briefs, and refresh history when the database lives on the persistent disk. Processes and in-flight HTTP requests do not survive restarts; interrupted refreshes are recorded as failures and require another manual refresh. Existing collected items are retained.

Keep a single instance. SQLite files must not be placed on ephemeral container storage or shared between multiple independent application replicas. Use Render disk snapshots or a consistent SQLite backup before migrations or destructive maintenance. Copying a live WAL database file alone is not a reliable backup. Test a restore before relying on a backup policy. Do not publish database backups, because they contain private research and authentication-session state.

The application has no scheduled refresh. Use **Refresh competitor** or **Refresh all** after confirming profile identities. Removing a competitor archives tracking while retaining research references; inspect the interface's confirmation text before any destructive board action.

## Container alternative

`Dockerfile` builds the same application with Node 24. Attach a writable persistent volume at `/var/data` and supply server-side secrets using your host's secret settings. Run behind an HTTPS reverse proxy. The runtime uses the unprivileged `node` user; a bind-mounted disk must be writable by that user. Never bake `.env` files, credentials, or the live database into the image.

## Publication evidence

Record the actual deployment URL only after the provider confirms deployment. Then verify owner sign-in, unauthorized API rejection, one live collection, saved references, and persistence after a controlled restart. Do not call a local development address, a proposed Render service name, or a development-environment snapshot a published website.

## Applying the production-build correction

The blueprint explicitly includes development dependencies during the build. Vite is needed to compile the client even though the deployed service runs in production mode. A plain `npm ci` with `NODE_ENV=production` can omit Vite and fail with `vite: not found`.

For an existing service created from an earlier blueprint, open its Blueprint in Render and use Manual Sync/Sync to apply the latest repository configuration. Confirm the build command shown in service settings is `npm ci --include=dev && npm run build`. If the configuration sync does not start a deployment, use Manual Deploy → Deploy latest commit. Watch the deployment until it is marked Live.
