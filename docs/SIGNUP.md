# Free signup and GoHighLevel lead capture

The free app's public form is `/signup`. Email/password registration immediately creates a separate client workspace and opens Workspace settings for ScrapeCreators setup. Personal email addresses are accepted; work email is suggested. Required: full name, email, company name and a password of at least 16 characters. Website and international phone number are optional. The email marketing checkbox is optional and unchecked.

Google and Facebook signup first authenticate with the provider, then collect the remaining company/contact details. Facebook Login is the Meta sign-in option; an Instagram-only login is not implemented. These public signup routes exist only in the free application. The separate paid ARPRA application retains its invitation flow.

## Deployment and secrets

Deploy the free repository to its existing Render service, retaining its database, persistent disk and encryption key. Migrations 006 and 007 add signup leads, rate limiting and social identities without deleting existing research or memberships. Render is configured for manual deployment: committing code alone does not publish it.

Set these values in **Render → free service → Environment**. Never put webhook URLs, API secrets or passwords in Git, the browser bundle, custom fields, screenshots or chat.

| Variable | Purpose |
| --- | --- |
| `LEVR_PUBLIC_SIGNUP` | `1`, or leave unset, enables signup. Set `0` to close new registration while existing users retain access. |
| `LEVR_SIGNUP_WEBHOOK_URL` | The secret GHL inbound webhook URL for Levr's own marketing/sales subaccount. |
| `PUBLIC_BASE_URL` | `https://levr-competitor-analysis.onrender.com`; Render's `RENDER_EXTERNAL_URL` is used if omitted. |
| `LEVR_GOOGLE_CLIENT_ID` / `LEVR_GOOGLE_CLIENT_SECRET` | Google web application OAuth credentials. |
| `LEVR_META_LOGIN_APP_ID` / `LEVR_META_LOGIN_APP_SECRET` | Meta developer app credentials for Facebook Login, distinct from paid Meta advertising access. |

Keep `LEVR_OWNER_PASSWORD`, `LEVR_SECRET_ENCRYPTION_KEY`, `DATABASE_PATH` and the existing disk intact. If upgrading an installation that lacks the encryption key, configure it through secure settings before clients connect ScrapeCreators. Do not replace an existing key. No cron job is added.

## GHL workflow

1. In **Levr's marketing/sales subaccount**, create a workflow and add an **Inbound Webhook** trigger. Check that the feature is available on your GHL plan. Keep outbound messaging inactive while setting up the mapping.
2. Copy its HTTPS URL into `LEVR_SIGNUP_WEBHOOK_URL` on the free Render service and deploy. The supported endpoint is `https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<trigger>`. The exact URL is a credential and is never displayed by the app.
3. Open `/signup` and register a test account using an email address you control. Capture that request in GHL's webhook trigger to expose the mapping fields. OAuth users must also complete the signup form before a lead is sent.
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
| `signup_method` | Custom field: password, google or facebook |
| `email_verified` | Custom field identifying whether Google verified the supplied email |
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

The latest visit containing UTM parameters supplies the signup's attribution. It replaces the prior campaign as a whole, avoiding a mixture of fields from different campaigns. Untagged internal pages and Google/Facebook round trips preserve it. Values stay in this tab's session storage for up to 24 hours and clear after successful signup; this is not cross-device attribution. Browser storage restrictions may prevent retention across redirects, but never prevent registration. Only these five parameters are captured, each limited to 200 characters; arbitrary query parameters and OAuth codes are not collected.

Create five text custom fields in GHL: **UTM source**, **UTM medium**, **UTM campaign**, **UTM content**, and **UTM term**. Map the matching lowercase payload keys to them in the Create/Update Contact action. Leave an existing value unchanged when the incoming field is blank. Captured values are also available in the owner-only Signup leads page under **Captured fields**, and retries preserve the original attribution. UTMs are supplied by the visitor's URL; they identify the claimed campaign, not verified advertising performance.

## Google signup

Create a Google OAuth **Web application** client, configure its consent screen for the intended audience, and register this exact redirect:

```text
https://levr-competitor-analysis.onrender.com/auth/oauth/google/callback
```

Store the client ID/secret in the Render variables above. Requested scopes are `openid email profile`. Google testing mode can restrict who can use the app; complete the relevant production configuration and supply your actual privacy-policy information in the provider console. The button is hidden until credentials and a valid public origin are configured.

## Meta / Facebook signup

Configure **Facebook Login** in your Meta developer app and register:

```text
https://levr-competitor-analysis.onrender.com/auth/oauth/facebook/callback
```

Store the app ID/secret in the Render variables above. Requests use `public_profile,email` through Graph v23.0. Complete Meta's current live-mode, app-domain, privacy and data-deletion requirements for the app and intended users. Development mode normally limits access to permitted app users/testers. This does not authorize access to advertising accounts.

Facebook may omit email; the completion form then asks for it. The app does not label that address verified. Google signup requires a verified email from Google's user-info endpoint.

## Access and operational behavior

- Social credentials are exchanged and discarded server-side. Google uses PKCE; both providers use expiring, single-use, browser-bound state. Short-lived browser tickets are stored only as hashes in SQL.
- Social signup never automatically links to an existing password account solely because its email matches. Existing users should use their existing login method. Owner access remains the configured owner password.
- New accounts are clients with access only to their new workspace. Supplying a workspace ID or role in a signup request cannot join another client's workspace or grant owner access.
- Signup attempts are limited per IP. Email/password signup grants immediate access without claiming the email is verified. Marketing consent is self-reported and recorded with the captured wording and timestamp.
- Lead data is owner-only and separate from client research. Delivery credentials stay in environment settings. Disconnecting the webhook does not erase captured leads.
- Each free workspace still needs its own verified ScrapeCreators connection for collection. Provider credits are not supplied by signup.

## Live acceptance

Verify one email/password signup, one Google signup and one Facebook signup, including Facebook's no-email case where available. Confirm the workspace opens immediately, an existing email cannot be silently relinked, private endpoints reject another client's workspace, GHL maps the correct fields, unchecked consent avoids marketing enrolment, duplicate delivery does not duplicate contacts/follow-up, and a failed webhook can be retried without losing the user. Real provider credentials and a published GHL workflow are required for this final live check; local mocks do not establish it.
