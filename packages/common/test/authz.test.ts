import { describe, expect, it } from 'vitest';
import { BUSINESS_PERMISSIONS, can } from '../src/index.js';

describe('business permissions', () => {
  it('owner can do everything', () => {
    for (const p of Object.keys(BUSINESS_PERMISSIONS) as (keyof typeof BUSINESS_PERMISSIONS)[]) {
      expect(can('owner', p)).toBe(true);
    }
  });

  it('only the owner handles legal details and billing', () => {
    for (const role of ['manager', 'front_desk', 'staff'] as const) {
      expect(can(role, 'business.legal')).toBe(false);
      expect(can(role, 'billing.manage')).toBe(false);
    }
  });

  it('front desk runs the day but cannot change settings or staff', () => {
    expect(can('front_desk', 'appointments.manage_all')).toBe(true);
    expect(can('front_desk', 'queue.operate')).toBe(true);
    expect(can('front_desk', 'business.update')).toBe(false);
    expect(can('front_desk', 'members.manage')).toBe(false);
  });

  it('staff only manage their own schedule', () => {
    expect(can('staff', 'schedule.manage_own')).toBe(true);
    expect(can('staff', 'schedule.manage_all')).toBe(false);
    expect(can('staff', 'appointments.manage_all')).toBe(false);
  });

  it('no role means no permission', () => {
    expect(can(null, 'business.view_private')).toBe(false);
    expect(can(undefined, 'schedule.manage_own')).toBe(false);
  });
});
