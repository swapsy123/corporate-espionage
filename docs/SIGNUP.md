# Free signup and GoHighLevel lead capture

The free app's public form is `/signup`. Email/password registration immediately creates a separate client workspace and opens Workspace settings for ScrapeCreators setup. Personal email addresses are accepted; work email is suggested. Required: full name, email, company name and a password of at least 12 characters. Website and international phone number are optional. The email marketing checkbox is optional and unchecked.

Signup and sign-in now use **email and password only**. Google and Facebook login have been removed; do not create developer apps or configure OAuth credentials for this launch. Existing account data and historical provider links are preserved. The separate paid ARPRA application retains its invitation flow.

## Deployment and secrets

Deploy the free repository to its existing Render service, retaining its database, persistent disk and encryption key. Migrations 006 and 007 add signup leads, rate limiting and social identities without deleting existing research or memberships. Render is configured for manual deployment: committing code alone does not publish it.

Set these values in **Render → free service → Environment**. Never put webhook URLs, API secrets or passwords in Git, the browser bundle, custom fields, screenshots or chat.

| Variable | Purpose |
| --- | --- |
| `LEVR_PUBLIC_SIGNUP` | `1`, or leave unset, enables signup. Set `0` to close new registration while existing users retain access. |
| `LEVR_SIGNUP_WEBHOOK_URL` | The secret GHL inbound webhook URL for Levr's own marketing/sales subaccount. |
| `PUBLIC_BASE_URL` | `https://levr-competitor-analysis.onrender.com`; canonical app URL, with Render's `RENDER_EXTERNAL_URL` as fallback. |

Keep `LEVR_OWNER_PASSWORD`, `LEVR_SECRET_ENCRYPTION_KEY`, `DATABASE_PATH` and the existing disk intact. If upgrading an installation that lacks the encryption key, configure it through secure settings before clients connect ScrapeCreators. Do not replace an existing key. No cron job is added.

## GHL workflow

1. In **Levr's marketing/sales subaccount**, create a workflow and add an **Inbound Webhook** trigger. Check that the feature is available on your GHL plan. Keep outbound messaging inactive while setting up the mapping.
2. Copy its HTTPS URL into `LEVR_SIGNUP_WEBHOOK_URL` on the free Render service and deploy. The supported endpoint is `https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<trigger>`. The exact URL is a credential and is never displayed by the app.
3. Open `/signup` and register a test account using an email address you control. Capture that request in GHL's webhook trigger to expose the mapping fields. The completed email/password form creates the lead.
4. Add a **Create/Update Contact** action. Match contacts by email and review the subaccount's duplicate-contact settings. Leave an existing contact's optional fields unchanged when the incoming field is blank; use conditional branches if needed. Preserve existing opt-outs/DND settings.
5. Map the fields below, then add an identifying tag such as `levr-free-signup`. Use the stable `event_id` as the signup identifier. A retry may occur after GHL accepted a request but the response was lost, so contact updates and any later follow-up must tolerate duplicates.
6. Keep marketing follow-up in a branch or separate workflow requiring `marketing_email_opt_in = true`, subject to the contact's existing opt-outs. The form does not request SMS consent; providing a phone number alone is not an SMS subscription. Repeated delivery of the same event should not restart a marketing sequence.
7. Publish the contact-capture workflow when its mapping is correct. In the free app's owner-only **Signup leads** page, review deliveries and manually retry any failed/unconfigured leads. There is no scheduled retry process.

| Payload field | Suggested GHL mapping |
| --- | --- |
| `first_name` | Contact first name |
| `last_name` | Contact last name |
| `full_name` | Optional custom field retaining the original full name |
| `email` | Contact email / matching key |
| `company_name` | Contact company name |
| `website` | Contact website, when supplied |
| `phone` | Contact phone, when supplied; includes country code |
| `source` | Source or a signup-source custom field |
| `event_id` | Custom field: Levr signup event ID |
| `workspace_id` | Custom field: Levr free workspace ID |
| `signup_method` | Custom field: `password` for all new signups; historical values are retained |
| `email_verified` | Custom field: `false` for email/password signup; do not treat an entered address as verified |
| `created_at` | Signup timestamp custom field |
| `marketing_email_opt_in` | Custom consent field / workflow condition, not an instruction to clear DND |
| `marketing_consent_at` | Consent timestamp; null when not selected |
| `marketing_consent_text` / `marketing_consent_version` | Consent evidence custom fields |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Corresponding attribution custom fields, if supplied on signup |

The original full name is preserved. The first word is supplied as `first_name` and the remaining words as `last_name` for convenient mapping; review names when that convention is inappropriate. Passwords, password hashes, OAuth tokens and ScrapeCreators credentials are never sent to GHL.

An accepted webhook response confirms delivery to the trigger, not completion of its downstream contact action. Check GHL workflow history and the resulting contact before declaring the live connection verified. Network/provider failures do not roll back signup or remove the lead. The owner can retry from the saved record; each retry retains the same event ID and captured consent.

## Campaign attribution

Add the five supported UTM parameters to links pointing to either the homepage or `/signup`, for example:

```text
https://levr-competitor-analysis.onrender.com/signup?utm_source=instagram&utm_medium=paid_social&utm_campaign=free_library&utm_content=carousel_01&utm_term=growth_operators
```

The latest visit containing UTM parameters supplies the signup's attribution. It replaces the prior campaign as a whole, avoiding a mixture of fields from different campaigns. Untagged internal pages and reloads preserve it. Values stay in this tab's session storage for up to 24 hours and clear after successful signup; this is not cross-device attribution. Browser storage restrictions may prevent retention across page loads, but never prevent registration. Only these five parameters are captured, each limited to 200 characters; arbitrary query parameters and OAuth codes are not collected.

Create five text custom fields in GHL: **UTM source**, **UTM medium**, **UTM campaign**, **UTM content**, and **UTM term**. Map the matching lowercase payload keys to them in the Create/Update Contact action. Leave an existing value unchanged when the incoming field is blank. Captured values are also available in the owner-only Signup leads page under **Captured fields**, and retries preserve the original attribution. UTMs are supplied by the visitor's URL; they identify the claimed campaign, not verified advertising performance.

## Retired Google and Facebook login

No Google/Meta app setup, OAuth secret or provider review is needed for current signup. Credential settings cannot re-enable the removed sign-in routes. Old start/reauthentication requests return HTTP 410; old callback links lead to the password signup page with an explanation. Pending provider tickets cannot bypass the password requirement or claim a verified email.

Startup invalidates temporary provider signup tickets, OAuth states and deletion-confirmation grants. It does not remove accounts, memberships, research, historical leads, linked identities or deletion audit records. There is no new database migration.

If any account previously relied on a provider, the owner should use **Client workspaces → select workspace → member → Create password reset** and deliver the single-use link privately. Resetting the password preserves the workspace and lets that client sign in and confirm account deletion with their password. Never create a duplicate account to work around an existing email. Existing password accounts require no action.

Historical Meta deletion callbacks/status pages remain available for a previously configured app; they cannot sign anyone in. Do not create a Meta app merely to configure that legacy endpoint. If an app/secret was already configured, preserve its deletion support until its historical data obligations are resolved.

## Access and operational behavior

- Registration always requires a password, including requests with old provider cookies. Owner access remains the configured owner password.
- New accounts are clients with access only to their new workspace. Supplying a workspace ID or role in a signup request cannot join another client's workspace or grant owner access.
- Signup attempts are limited per IP. Email/password signup grants immediate access without claiming the email is verified. Marketing consent is self-reported and recorded with the captured wording and timestamp.
- Lead data is owner-only and separate from client research. Delivery credentials stay in environment settings. Disconnecting the webhook does not erase captured leads.
- Each free workspace still needs its own verified ScrapeCreators connection for collection. Provider credits are not supplied by signup.

## Live acceptance

Verify email/password signup, sign-in, password reset and password-confirmed account deletion. Confirm no Google/Facebook buttons are shown and old provider routes cannot authenticate. Confirm the workspace opens immediately, an existing email cannot be silently relinked, private endpoints reject another client's workspace, GHL maps the correct fields, unchecked consent avoids marketing enrolment, duplicate delivery does not duplicate contacts/follow-up, and a failed webhook can be retried without losing the user. A published GHL workflow and actual test signup are required for the live handoff check; local mocks do not establish it.

## Account and lead deletion

Migration **008_account_deletion.sql** is additive. It creates deletion audit, file-cleanup, social confirmation and Meta confirmation tables without dropping or rewriting existing account/research tables. No existing customer is deleted by migration, and no timed retention or purge job is introduced.

The shared `createAccountDeletion(...).deleteAccount(userId, { reason, actorId })` service is used by owner deletion, client deletion, Meta callbacks and the setup-account cleanup command. Supported reasons are `owner_request`, `self_service`, `meta_request` and `setup_cleanup`. Fixed reason codes keep free-form personal data out of the audit.

Deletion removes the account's sessions, memberships, social identities, signup lead payload, matching invitations/reset links, user record and associated incomplete social signups. Deletion challenges/grants are removed too. The owner has no client user row and cannot be deleted; the Levr owner workspace is protected. Deleting an already-deleted account succeeds idempotently and can resume pending file cleanup.

Exclusively associated workspaces are removed, including research databases, SQLite sidecar files and encrypted ScrapeCreators credentials, including orphaned ciphertext from interrupted atomic writes. Cached database handles are closed first. Shared workspaces remain available to other accounts. An empty workspace still referenced by another account's signup is also retained until that association is removed, avoiding deletion of another person's lead or a broken foreign key. The confirmation screen identifies which workspaces will be removed or retained. Invitations to a removed workspace are deleted too.

All catalog changes commit in one transaction before file cleanup. A failed transaction preserves the account and files. If file cleanup fails after commit, access stays revoked and a durable, sanitized cleanup record remains. The owner can retry in **Client workspaces → Deletion records**, including after restart. No automatic cleanup schedule is added.

The audit retains the account UUID, SHA-256 of its normalized email, deletion time, actor role/UUID where applicable, fixed reason, cleanup progress and original signup event ID. It does not retain email, name, company, original lead payload, password hash, API key or OAuth credentials. Hashed provider-subject markers stop old OAuth responses and repeated Meta callbacks from affecting a later registration. Audit/marker retention periods remain undecided; these hashes are pseudonymous data, not proof of anonymization. Global short-lived IP attempt buckets and unlinked OAuth state have no user ID association and keep their existing expiry behavior.

Deletion removes active database records, with SQLite secure deletion enabled for freed catalog pages. Hosting backups, snapshots and database journal retention require separate operational handling. This is not a guarantee of erasure from all historical backups.

**GoHighLevel remains separate.** The inbound webhook cannot erase a contact already received by GHL. Queued deliveries are skipped and active requests are aborted where possible, but an already-received request cannot be recalled. Audit records flag possible CRM follow-up and retain the signup `event_id` so the owner can locate the contact without keeping the deleted email here. Handle that CRM record and any backups separately under the applicable privacy policy. The public Meta status page reports active-app deletion, not those external steps. Account deletion does not cancel a ScrapeCreators subscription.

### Owner and client controls

The owner opens **Client workspaces → Client accounts**, finds the account (including accounts with revoked memberships), selects **Delete account**, reviews the scope and types the email. Membership revocation remains a separate action and does not delete the account.

Clients open **Workspace settings → Delete your account**, review the scope, type their email and re-enter their password. Historical provider-only accounts first need the owner-issued password-reset flow described above. Previous provider-confirmation grants no longer authorize deletion.

Authenticated deletion routes sit before workspace-scoping middleware and retain role and CSRF checks:

| Route | Access / purpose |
| --- | --- |
| `GET /api/accounts?email=...&page=1` | Owner: list/search by exact email |
| `GET /api/accounts/:userId/deletion` | Owner: preview deletion scope |
| `DELETE /api/accounts/:userId` | Owner: typed `confirmationEmail` |
| `GET /api/account-deletions?page=1` | Owner: audit and cleanup records |
| `POST /api/account-deletions/:id/retry` | Owner: retry recorded file cleanup |
| `GET /api/account/deletion` | Client: own scope and confirmation methods |
| `POST /api/account/deletion/reauth/:provider` | Retired: authenticated requests return HTTP 410 |
| `DELETE /api/account` | Client: own account; `confirmationEmail` plus current account password |

### Historical Meta data-deletion callback

This endpoint is retained for historical data only. **It is not a launch setup requirement now that Facebook Login has been removed.** For an app already configured previously, its callback remains:

```text
https://levr-competitor-analysis.onrender.com/auth/oauth/facebook/data-deletion
```

`POST /auth/oauth/facebook/data-deletion` accepts Meta's form-encoded `signed_request` (JSON also works). It verifies the base64url signature using HMAC-SHA256 and `LEVR_META_LOGIN_APP_SECRET`, checks the declared algorithm, numeric Facebook subject and issued timestamp, and rejects tampering. `PUBLIC_BASE_URL` or `RENDER_EXTERNAL_URL` supplies the trusted absolute status URL, never the request Host header. This signature-authenticated callback requires no browser session or CSRF token.

The response contains `url` and `confirmation_code`. Unknown identities receive the same response shape and a valid confirmation page, without disclosure that the account was unknown. Incomplete Facebook registrations are removed where applicable. Repeated callbacks cannot delete a later account registered after the original request. When file cleanup needs retry, associated confirmation pages remain pending until cleanup succeeds.

`GET /auth/oauth/facebook/data-deletion/:code` is a public, non-cached status page. Codes are random and only their hashes are stored; the page contains no email, account ID or provider subject. The callback implementation does not itself establish Meta Live-mode approval or replace an accurate privacy/deletion policy.

### Remove the four setup accounts

After manual deployment, run in the **existing free service's Render Shell**, using its existing environment:

```sh
node scripts/delete-setup-accounts.mjs
node scripts/delete-setup-accounts.mjs --apply
```

The first command previews; the second deletes only these exact aliases, if present:

- `braceyfraser+levrtest1@gmail.com`
- `braceyfraser+levrtest2@gmail.com`
- `braceyfraser+levrtest3@gmail.com`
- `braceyfraser+levrtest4@gmail.com`

The command signs into the running service over loopback with the existing `LEVR_OWNER_PASSWORD` and `OWNER_EMAIL`, then calls the shared deletion API. It prints counts, never credentials. This lets the running process close its own database connections and cancel queued deliveries. Do not paste credentials into the shell or run direct/offline deletion SQL while the app is running. The unaliased account, `+levrtest5`, unrelated clients and paid ARPRA remain untouched. Re-running is safe.

If cleanup remains pending, inspect **Deletion records**, or explicitly retry previously requested file cleanup:

```sh
node scripts/delete-setup-accounts.mjs --retry-cleanup
```

This retries pending file-cleanup records only; it does not discover or delete new accounts. Verify the four test contacts separately in GHL using their signup event IDs.
