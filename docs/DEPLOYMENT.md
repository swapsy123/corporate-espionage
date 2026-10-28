# Private deployment

Levr Competitor Analysis uses a single Node 24 server with SQLite databases and encrypted secret files on persistent storage. Render's paid web service with an attached disk is the initial host. Research endpoints require authenticated workspace access. The owner can manage every workspace; invited clients can access only their assigned workspaces. The sign-in page, invitation-acceptance page, and static interface assets are publicly reachable.

Creating a hosting account, connecting GitHub, and entering deployment secrets require the owner's account access. Cloud development-environment publication is separate from website deployment. Committing a blueprint creates no service or charge.

## Update the existing service for client workspaces

1. Before deploying the workspace migration, take a consistent backup or Render disk snapshot of the existing persistent data. Keep the current `DATABASE_PATH=/var/data/levr.sqlite` and disk attached. Existing Levr research stays in its original database.
2. Open the service's **Blueprint** in Render and choose **Manual Sync** to apply the latest `render.yaml`. The new `LEVR_SECRET_ENCRYPTION_KEY` entry uses `generateValue: true`, so Render generates the encryption secret in its environment settings. No value belongs in Git, chat, or the application database.
3. Verify that the variable is present in Render's Environment settings without exposing its value. Preserve an existing value. **Manual Deploy alone does not apply a new blueprint environment-variable declaration.** If the variable is absent, sync the blueprint or create it through Render's secure settings with a unique random value of at least 32 characters.
4. If blueprint sync does not start deployment, choose **Manual Deploy → Deploy latest commit**. Wait for the service to show **Live**. Automatic deployment is disabled in the blueprint.
5. Sign in as the owner and verify that the original Levr library remains available. Create a client workspace, create an invitation for its intended email address, and copy the invitation link to the client through your chosen private channel. The app does not send invitation emails.
6. After the client accepts the invitation and sets a password, **Workspace settings** opens automatically. The setup guide links to their ScrapeCreators account and shows how to connect. They enter their own key in the masked field and select **Connect ScrapeCreators**. Levr checks account access before saving; the guide disappears only after verification. Confirm a public profile and run one manual refresh to validate collection with that account.

Client workspaces never fall back to Levr's ScrapeCreators account or credits. A client without its own configured key can use its existing saved research, but cannot collect new content. New client workspaces start with an empty library and a Creative Inbox; Levr's competitor list, notes, boards, briefs, and collected data are not copied into them.

If the encryption variable is missing, client key storage must fail closed. Do not work around this by storing plaintext keys or placing client keys in SQL records. Keep `LEVR_SECRET_ENCRYPTION_KEY` stable while encrypted keys exist. Replacing or losing it makes existing client keys unreadable; restore the original secret from secure backup or have clients reconnect their keys. Key rotation requires an explicit decrypt-and-reencrypt migration and is not an ordinary redeployment step.

## Create a new service

1. Create or sign in to a Render account. Connect the private GitHub repository containing this project and authorize access to that repository only.
2. Choose **New → Blueprint** and select the repository and branch containing `render.yaml`.
3. Review the web-service and persistent-disk costs shown by Render before creating resources. The blueprint requests one `starter` instance and a 1 GB disk; it creates no cron job or additional instances.
4. In Render's secure environment settings, enter `LEVR_OWNER_PASSWORD` (a unique password of at least 16 characters) and Levr's `SCRAPECREATORS_API_KEY`. Keep `OWNER_EMAIL=fraser@wearelevr.com`. The blueprint generates `LEVR_SECRET_ENCRYPTION_KEY` for encrypted client key storage.
5. Apply the blueprint. Render runs `npm ci --include=dev && npm run build`, then `npm start`. `DATABASE_PATH=/var/data/levr.sqlite` must remain on the attached disk. Keep `NODE_ENV=production` so session cookies require HTTPS.
6. Once the health check passes, use the HTTPS service URL supplied by Render. Verify owner sign-in, signed-out API rejection, client workspace isolation, and one manual collection with each account that will be used.

A successful build or `/healthz` response alone does not verify provider collection. Live verification requires a configured ScrapeCreators account with sufficient credits, confirmed profile identifiers, and working network access.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAIL` | Levr administrator login; default `fraser@wearelevr.com`. The owner can manage all client workspaces. |
| `LEVR_OWNER_PASSWORD` | Owner authentication secret; minimum 16 characters. Enter through secure runtime settings. Client passwords are created through invite acceptance. There is no public sign-up. |
| `SCRAPECREATORS_API_KEY` | Server-side fallback for the original **Levr workspace only**, sent to `api.scrapecreators.com`. Client workspaces supply their own keys through Settings. |
| `LEVR_SECRET_ENCRYPTION_KEY` | Stable master secret, at least 32 characters, generated by Render via the blueprint. Encrypts client provider-key files with AES-GCM. Never expose it to the client or store it in SQL. |
| `LEVR_AI_API_KEY` | Optional server-side OpenAI integration for richer original adaptations. Evidence-backed analysis and structured briefs also work without it. |
| `DATABASE_PATH` | Original Levr research database and workspace/auth catalog on durable storage; `/var/data/levr.sqlite` on Render. Workspace databases and encrypted secret files live in sibling directories on the same disk. |
| `NODE_ENV` | Set to `production` on an HTTPS deployment. |
| `PORT` | Supplied by Render. Defaults to the application's local port otherwise. |
| `TRUST_PROXY` | Blueprint sets `1` for Render's reverse proxy, so sign-in rate limits use the forwarded client address. Leave unset when serving directly; change only to match the actual proxy topology. |

The local cloud environment's secret-proxy bindings do not automatically configure Render. Add deployment credentials through Render's secure settings. ScrapeCreators collection needs HTTPS access to `api.scrapecreators.com`; optional AI needs `api.openai.com`. Original creative viewers access public provider/CDN URLs in the browser and may depend on provider availability or expiring media URLs.

API keys are never returned from Settings, embedded in browser bundles, written to SQL, or included in diagnostic responses. The masked setup field sends a newly entered client key over HTTPS to the server. It is encrypted into a workspace-specific file outside the database, and the interface clears the entered value after saving. Do not use a `VITE_` prefix for any secret.

The guided-setup update needs no additional environment variables or SQL migration once client workspaces are deployed. Use **Manual Deploy → Deploy latest commit**. Existing encrypted keys remain readable and can be verified in Settings without re-entering them. Verification dates are stored inside the encrypted key file; Levr's environment-key verification is held in memory and needs rechecking after a restart. Verification checks account access, not the success of future content collection or available future credits.

## Durable data and maintenance

The application applies versioned SQL migrations at startup. `npm run db:migrate` applies the catalog/Levr migrations and runs an integrity check explicitly. A restart preserves research when the data paths remain on the persistent disk. The durable layout is:

- `/var/data/levr.sqlite`: original Levr research, users, workspace membership, invitations, and authentication catalog.
- `/var/data/workspaces/`: separate client research databases.
- `/var/data/secrets/`: workspace-specific AES-GCM encrypted provider-key files. Plaintext API keys are not written here.

The encryption master secret stays separately in Render's secure environment settings. Workspace identifiers bind encrypted files to their intended workspace; copying a client's encrypted file to another workspace is not a supported transfer method.

Keep a single instance. SQLite databases must not be placed on ephemeral container storage or shared across independent application replicas. Plan disk capacity for all workspaces. Back up the **whole durable data directory**, including workspace databases and encrypted secret files, using a consistent snapshot or SQLite-aware backup while writes are quiesced. Copying a live WAL database file alone is not a reliable backup. Keep a separate secure backup of the stable encryption master secret, and test restoring both data and that secret together. Do not publish data backups or credential backups.

Processes and in-flight HTTP requests do not survive restarts. Interrupted refreshes are recorded as failures and require another manual refresh; previously collected records remain saved. There is no scheduled refresh. Use **Refresh** or **Refresh confirmed competitors** in the intended workspace. Removing a competitor archives tracking while retaining research. Revoking an invitation prevents its later use; removing a member prevents that user's access to the workspace and revokes their sessions.

## Invitations and client access

Only the owner creates client workspaces and invitations. Invitation tokens are cryptographically random, expire, and are single-use. Only their hashes are stored in the authentication database. Links use the URL fragment (`/invite#token=…`) so the token is not sent as part of the page URL to HTTP access logs. Treat the copied link as private and deliver it only to the intended person. The recipient must use the invited email address and set a password; an existing account must authenticate with its existing password.

Clients cannot enumerate or select other clients' workspaces. The server checks membership on each request; hiding navigation alone is not an access control. The owner can switch into every workspace for support and management, but saved provider keys remain unreadable through the dashboard.

## Container alternative

`Dockerfile` builds the same application with Node 24. Attach a writable persistent volume at `/var/data` and supply server-side secrets using the host's secret settings, including the stable `LEVR_SECRET_ENCRYPTION_KEY`. Run behind an HTTPS reverse proxy. The runtime uses the unprivileged `node` user; a bind-mounted disk must be writable by that user. Never bake `.env` files, credentials, or live databases into the image.

## Publication checks

Record the actual deployment URL only after the provider confirms deployment. Verify owner and invited-client sign-in, unauthorized API rejection, attempts to access a different client's record, one live collection with each workspace's own provider key, saved references, invitation revocation, and persistence after a controlled restart. Local test fixtures do not establish live provider access.

## Production build dependencies

The blueprint explicitly includes development dependencies during the build. Vite is needed to compile the client even though the deployed service runs in production mode. A plain `npm ci` with `NODE_ENV=production` can omit Vite and fail with `vite: not found`. The build command must remain `npm ci --include=dev && npm run build`.

The optional server-wide AI key is used only by the Levr workspace. Client workspaces use the evidence-guided brief templates; their data and requests do not consume Levr’s optional AI account.
