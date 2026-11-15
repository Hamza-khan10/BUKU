import { describe, expect, it } from 'vitest';
import {
  changedSettings,
  profileChanges,
  reverifies,
  TICKET_PREFIX,
  wholeNumber,
  type ProfileDraft,
} from '../src/features/manage/settings';

const draft: ProfileDraft = {
  name: 'Fade Masters',
  description: 'Classic cuts.',
  phone: '+924235550000',
  email: 'hello@fademasters.pk',
  website: '',
  address: '12 Main Boulevard',
  city: 'Lahore',
  state: 'Punjab',
  postalCode: '54000',
  place: { lat: 31.5204, lng: 74.3587 },
};

describe('Settings', () => {
  it('sends only what changed, trimmed; clearing an optional field is caught, not lost', () => {
    expect(profileChanges(draft, { ...draft })).toEqual({ change: {}, cleared: [] });
    expect(
      profileChanges(draft, { ...draft, description: '  Hot towels too.  ', website: 'https://fm.pk' }),
    ).toEqual({
      change: { description: 'Hot towels too.', website: 'https://fm.pk' },
      cleared: [],
    });
    expect(profileChanges(draft, { ...draft, name: ' Fade Masters ' }).change).toEqual({});
    expect(profileChanges(draft, { ...draft, phone: '', email: '  ' })).toEqual({
      change: {},
      cleared: ['phone', 'email'],
    });
    // The place moves as a pair.
    expect(profileChanges(draft, { ...draft, place: { lat: 31.5205, lng: 74.3587 } }).change).toEqual({
      lat: 31.5205,
      lng: 74.3587,
    });
    expect(profileChanges({ ...draft, place: null }, draft).change).toEqual({ lat: 31.5204, lng: 74.3587 });
  });

  it('warns that a verified (or rejected) business goes back to review when what was checked changes', () => {
    expect(reverifies({ name: 'Fade Masters Gulberg' }, 'verified')).toBe(true);
    expect(reverifies({ city: 'Karachi' }, 'rejected')).toBe(true);
    expect(reverifies({ lat: 31.6, lng: 74.3 }, 'verified')).toBe(true);
    expect(reverifies({ description: 'New words', phone: '+924200000000' }, 'verified')).toBe(false);
    expect(reverifies({ name: 'Anything' }, 'pending')).toBe(false);
  });

  it('takes whole numbers in range only', () => {
    const range = { min: 0, max: 168 };
    expect(wholeNumber('12', range)).toEqual({ ok: true, value: 12 });
    expect(wholeNumber(' 0 ', range)).toEqual({ ok: true, value: 0 });
    for (const bad of ['', '-1', '12.5', '1e3', '169', '1 2', 'twelve', '00000000'])
      expect(wholeNumber(bad, range).ok).toBe(false);
    expect(wholeNumber('500', range)).toEqual({ ok: false, message: 'Enter a whole number from 0 to 168.' });
  });

  it('keeps only changed settings, and ticket letters are 1–3 letters', () => {
    expect(changedSettings({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: null })).toEqual({ b: 'y' });
    expect(changedSettings({ a: 1, c: null as number | null }, { a: 1, c: 60 })).toEqual({ c: 60 });
    expect(changedSettings({ a: 1 }, { a: 1 })).toEqual({});
    for (const ok of ['A', 'ab', 'XYZ']) expect(TICKET_PREFIX.test(ok)).toBe(true);
    for (const bad of ['', 'ABCD', 'A1', 'A-', 'ب', ' A']) expect(TICKET_PREFIX.test(bad)).toBe(false);
  });
});
