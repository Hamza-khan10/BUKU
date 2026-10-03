import { describe, expect, it } from 'vitest';
import { createServiceMetrics, recordSecurityEvent } from '../src/http/metrics.js';

describe('Security event metrics (D-082)', () => {
  it('counts each kind of event for alerting, labelled with the service', async () => {
    const { registry } = createServiceMetrics('auth-test');
    recordSecurityEvent('mfa_failed');
    recordSecurityEvent('mfa_failed');
    recordSecurityEvent('refresh_token_reuse');
    const text = await registry.metrics();
    expect(text).toMatch(/security_events_total\{event="mfa_failed",service="auth-test"\} 2/);
    expect(text).toMatch(/security_events_total\{event="refresh_token_reuse",service="auth-test"\} 1/);
  });
});
