import { describe, expect, it } from 'vitest';
import { chainStanding, ENTERPRISE_PLAN, NETWORK_PLAN } from '../src/chain.js';

describe('a chain’s standing (D-146)', () => {
  it('one live Enterprise plan anywhere makes the whole chain Enterprise', () => {
    expect(chainStanding([NETWORK_PLAN, null, ENTERPRISE_PLAN, 'business_free'])).toBe('enterprise');
  });

  it('otherwise a live Network plan makes it a Network chain', () => {
    expect(chainStanding([null, NETWORK_PLAN, 'business_professional'])).toBe('network');
  });

  it('anything else, or nothing live, is neither', () => {
    expect(chainStanding([])).toBe('other');
    expect(chainStanding([null, undefined, 'business_free', 'business_professional'])).toBe('other');
  });
});
