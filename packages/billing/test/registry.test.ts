import { describe, expect, it } from 'vitest';
import { describeKeys, featureKeysOf, launchedFeatureKeysOf } from '../src/index.js';

describe('features BUKU offers today', () => {
  it('ads exist as a plan setting, but nothing advertises them until the ads service does (D-087)', () => {
    expect(featureKeysOf('business')).toContain('ads');
    expect(launchedFeatureKeysOf('business')).not.toContain('ads');
    expect(describeKeys('business').features.map((f) => f.key)).not.toContain('ads');
    expect(launchedFeatureKeysOf('business')).toEqual([
      'queue',
      'manual_approval',
      'staff_photos',
      'priority_support',
    ]);
  });
});
