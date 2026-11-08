import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../shared/password-policy.js';

export const CONSENT_VERSION = 'email-resources-and-offers-v1';
export const CONSENT_TEXT = 'Email me useful resources and information about Levr’s paid services. I can unsubscribe at any time.';
const optionalText = maximum => z.string().trim().max(maximum).optional().default('');
export const signupInput = z.object({
  fullName: z.string().trim().min(2,'Enter your full name.').max(160),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  companyName: z.string().trim().min(1,'Enter your company name.').max(160),
  website: optionalText(500).transform(value => {
    if (!value) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
    let url; try { url = new URL(candidate); } catch {}
    if (!url || !['https:','http:'].includes(url.protocol) || url.username || url.password)
      return z.NEVER;
    return url.href;
  }).refine(value => typeof value === 'string','Enter a website such as https://example.com.'),
  phone: optionalText(40).refine(value => !value || /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s().-]/g,'')), 'Include the country code, for example +44 7700 900123.')
    .transform(value => value.replace(/[\s().-]/g,'')),
  marketingConsent: z.boolean().optional().default(false),
  password: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  // Honeypot: real forms leave this empty. Never include it in a lead payload.
  contactAddress: optionalText(200),
  attribution: z.object({
    utm_source:optionalText(200),utm_medium:optionalText(200),utm_campaign:optionalText(200),
    utm_content:optionalText(200),utm_term:optionalText(200),
  }).optional().default({}),
});
export function leadPayload({id,workspaceId,createdAt,fields,emailVerified=false,provider='password'}) {
  const [firstName,...nameRemainder]=fields.fullName.split(/\s+/);
  return {
    event:'free_workspace.signup',schema_version:1,event_id:id,signup_id:id,
    workspace_id:workspaceId,created_at:createdAt,source:'Levr free competitor analysis',
    full_name:fields.fullName,first_name:firstName,last_name:nameRemainder.join(' '),email:fields.email,company_name:fields.companyName,
    website:fields.website,phone:fields.phone,signup_method:provider,email_verified:emailVerified,
    marketing_email_opt_in:fields.marketingConsent,marketing_sms_opt_in:false,
    marketing_consent_text:CONSENT_TEXT,marketing_consent_version:CONSENT_VERSION,
    marketing_consent_at:fields.marketingConsent?createdAt:null,
    ...fields.attribution,
  };
}
