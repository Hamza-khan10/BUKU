/** One step in an audit trail, as the API shows it to platform admins (3.6f). */
export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  target: { type: string; id: string | null; label: string | null } | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
}

export type Mood = 'stop' | 'go' | 'look' | 'sign-in' | 'change';

/** Each recorded step in words ("suspended an account"), and what kind of step it is. */
const STEPS: Record<string, [text: string, mood: Mood]> = {
  'admin.account_looked_up': ['looked up an account', 'look'],
  'admin.account_suspended': ['suspended an account', 'stop'],
  'admin.account_reinstated': ['reinstated an account', 'go'],
  'admin.account_trail_viewed': ['opened an account’s activity', 'look'],
  'admin.sessions_ended': ['signed someone out everywhere', 'stop'],
  'account.suspended': ['suspended this account', 'stop'],
  'account.reinstated': ['reinstated this account', 'go'],
  'admin.switch_turned_off': ['turned off an emergency switch', 'stop'],
  'admin.switch_turned_on': ['turned an emergency switch back on', 'go'],
  'admin.business_verified': ['verified a business', 'go'],
  'admin.business_rejected': ['didn’t approve a business', 'stop'],
  'admin.business_suspended': ['suspended a business', 'stop'],
  'admin.business_reinstated': ['reinstated a business', 'go'],
  'admin.business_export': ['exported businesses for a lawful request', 'look'],
  'admin.report_resolved': ['closed a report', 'change'],
  'admin.review_hidden': ['hid a review', 'stop'],
  'admin.review_kept': ['kept a reported review', 'go'],
  'admin.review_restored': ['put a hidden review back', 'go'],
  'admin.document_approved': ['approved a document', 'go'],
  'admin.document_rejected': ['rejected a document', 'stop'],
  'admin.documents_viewed': ['viewed a business’s documents', 'look'],
  'admin.legal_profile_viewed': ['viewed a business’s legal details', 'look'],
  'access_review.generated': ['produced the access review', 'look'],
  'auth.signed_in': ['signed in', 'sign-in'],
  'auth.signed_up': ['created their account', 'sign-in'],
  'auth.dev_signed_in': ['signed in (development)', 'sign-in'],
  'auth.member_signed_in': ['signed in with a business login', 'sign-in'],
  'auth.mfa_verified': ['passed two-step sign-in', 'sign-in'],
  'auth.mfa_step_up': ['confirmed two-step sign-in again', 'sign-in'],
  'auth.mfa_failed': ['entered a wrong two-step code', 'stop'],
  'auth.all_sessions_ended': ['was signed out everywhere', 'change'],
  'auth.password_changed': ['changed their password', 'change'],
  'auth.provider_linked': ['linked a sign-in provider', 'change'],
  'auth.refresh_token_reuse_detected': ['had a stolen session token used', 'stop'],
  'mfa.enabled': ['turned on two-step sign-in', 'go'],
  'mfa.disabled': ['turned off two-step sign-in', 'stop'],
  'mfa.setup_started': ['started setting up two-step sign-in', 'change'],
  'mfa.recovery_code_used': ['used a recovery code', 'change'],
  'mfa.recovery_codes_replaced': ['replaced their recovery codes', 'change'],
  'billing.plan_granted': ['granted a plan', 'change'],
  'admin.plan_request_approved': ['approved a plan request', 'go'],
  'admin.plan_request_declined': ['declined a plan request', 'stop'],
  'admin.plan_granted': ['gave a business a plan', 'go'],
  'admin.subscription_ended': ['ended a subscription', 'stop'],
  'billing.plan_request_approved': ['approved a plan request', 'go'],
  'billing.plan_request_declined': ['declined a plan request', 'stop'],
  'billing.price_synced': ['linked a price to Paddle', 'change'],
  'billing.settings_updated': ['changed billing settings', 'change'],
  'notifications.settings_updated': ['changed notification settings', 'change'],
};

export function stepOf(action: string): { text: string; mood: Mood } {
  const known = STEPS[action];
  if (known) return { text: known[0], mood: known[1] };
  if (action.startsWith('billing.'))
    return { text: `billing: ${action.slice(8).replaceAll('_', ' ')}`, mood: 'change' };
  return { text: action.replaceAll('_', ' ').replace('.', ': '), mood: 'change' };
}

/** The log's views: what kind of step. The API's own names. */
export const AREAS = [
  { value: 'all', label: 'Everything' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'businesses', label: 'Businesses' },
  { value: 'reviews', label: 'Reviews' },
  { value: 'switches', label: 'Switches' },
  { value: 'sign-in', label: 'Sign-ins' },
  { value: 'billing', label: 'Billing' },
  { value: 'access', label: 'Access' },
] as const;

export const PERIODS = [
  { value: 1, label: '24 hours' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
] as const;
