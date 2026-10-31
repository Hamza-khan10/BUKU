/**
 * The development data the seed builds (prisma/seed-v2.ts): Pakistani cities, what each kind of
 * business offers, the businesses, names. Deterministic: the same world every time.
 */

/** Seeded randomness (mulberry32): the same sequence for the same seed. */
export function createRandom(seed: number) {
  let state = seed;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  return { rand, pick, int };
}

// All seeded businesses are in Pakistan (Asia/Karachi, UTC+5, no DST), so a
// fixed offset converts local wall-clock times to UTC correctly here.
export const PKT_OFFSET_MINUTES = 5 * 60;
export function pktToUtc(day: Date, hh: number, mm: number): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm) - PKT_OFFSET_MINUTES * 60_000,
  );
}

// Categories aren't seeded: the migrations ship them, so every database has the same list.

export const CITIES = [
  { city: 'Lahore', state: 'Punjab', lat: 31.5204, lng: 74.3587, phone: '+9242' },
  { city: 'Karachi', state: 'Sindh', lat: 24.8607, lng: 67.0011, phone: '+9221' },
  { city: 'Islamabad', state: 'Islamabad Capital Territory', lat: 33.6844, lng: 73.0479, phone: '+9251' },
  { city: 'Rawalpindi', state: 'Punjab', lat: 33.5651, lng: 73.0169, phone: '+9251' },
] as const;

export const SERVICE_MENUS: Record<string, [string, number, number][]> = {
  Barbershop: [
    ['Haircut', 30, 800],
    ['Beard Trim', 15, 400],
    ['Haircut + Beard', 45, 1100],
    ['Hot Towel Shave', 30, 700],
  ],
  'Hair Salon': [
    ['Cut & Blow-dry', 60, 3500],
    ['Hair Colour', 120, 9000],
    ['Keratin Treatment', 150, 15000],
  ],
  'Nail Salon': [
    ['Manicure', 45, 2000],
    ['Pedicure', 60, 2500],
    ['Gel Nails', 75, 4000],
  ],
  'Dental Clinic': [
    ['Check-up', 30, 3000],
    ['Scaling & Polishing', 45, 6000],
    ['Filling', 60, 8000],
  ],
  'General Physician': [
    ['Consultation', 20, 2500],
    ['Follow-up Visit', 15, 1500],
  ],
  Physiotherapy: [
    ['Assessment', 45, 4000],
    ['Therapy Session', 60, 3500],
  ],
  Spa: [
    ['Signature Facial', 60, 6000],
    ['Body Scrub', 45, 5000],
  ],
  Massage: [
    ['Swedish Massage', 60, 5500],
    ['Deep Tissue Massage', 90, 8000],
  ],
  'Yoga Studio': [
    ['Private Yoga Class', 60, 4000],
    ['Breathwork Session', 45, 2500],
  ],
  Gym: [
    ['Induction Session', 45, 1500],
    ['Body Composition Scan', 20, 1000],
  ],
  'Personal Training': [
    ['PT Session', 60, 4000],
    ['Fitness Assessment', 45, 3000],
  ],
  'Car Wash': [
    ['Exterior Wash', 30, 1200],
    ['Full Detail', 120, 8000],
    ['Interior Clean', 60, 3500],
  ],
  'Auto Repair': [
    ['Oil Change', 45, 4500],
    ['Brake Inspection', 60, 2500],
  ],
  'Pet Grooming': [
    ['Bath & Brush', 60, 3000],
    ['Full Groom', 90, 5000],
  ],
  Veterinary: [
    ['Wellness Exam', 30, 3500],
    ['Vaccination', 15, 2500],
  ],
  'Passport Office': [
    ['New Passport Application', 20, 0],
    ['Renewal', 15, 0],
  ],
  'Utility Services': [
    ['New Connection Request', 20, 0],
    ['Billing Query', 15, 0],
  ],
  Tailor: [
    ['Measurement & Fitting', 30, 1000],
    ['Alteration Drop-off', 15, 500],
  ],
  'Legal Consultation': [
    ['Initial Consultation', 60, 10000],
    ['Document Review', 45, 7500],
  ],
};

export const BUSINESS_NAMES: [string, string][] = [
  ['Barbershop', 'Fade Masters'],
  ['Barbershop', 'The Gentlemen’s Chair'],
  ['Hair Salon', 'Studio Noor'],
  ['Nail Salon', 'Polished Nail Lounge'],
  ['Dental Clinic', 'Smile Care Dental'],
  ['Dental Clinic', 'Bright Dental Studio'],
  ['General Physician', 'City Family Clinic'],
  ['Physiotherapy', 'Motion Physio Centre'],
  ['Spa', 'Serenity Day Spa'],
  ['Massage', 'Kneaded Relief'],
  ['Yoga Studio', 'Prana Yoga House'],
  ['Gym', 'Iron Republic Gym'],
  ['Personal Training', 'Peak Performance PT'],
  ['Car Wash', 'Sparkle Auto Spa'],
  ['Auto Repair', 'Precision Motors'],
  ['Pet Grooming', 'Pawfect Grooming'],
  ['Veterinary', 'Happy Tails Vet'],
  ['Passport Office', 'Citizen Passport Centre'],
  ['Tailor', 'Stitch & Style Tailors'],
  ['Legal Consultation', 'Justice Partners Law'],
];

export const FIRST = [
  'Ayesha',
  'Ali',
  'Fatima',
  'Hamza',
  'Zainab',
  'Usman',
  'Maryam',
  'Bilal',
  'Sana',
  'Omar',
  'Hira',
  'Ahmed',
  'Mahnoor',
  'Saad',
  'Iqra',
  'Danish',
  'Noor',
  'Faisal',
  'Amna',
  'Hassan',
];
export const LAST = [
  'Khan',
  'Ahmed',
  'Malik',
  'Hussain',
  'Qureshi',
  'Siddiqui',
  'Chaudhry',
  'Butt',
  'Sheikh',
  'Raza',
  'Iqbal',
  'Mirza',
];
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
