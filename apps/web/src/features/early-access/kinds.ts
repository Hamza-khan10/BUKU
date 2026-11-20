/**
 * The kinds of business the early-access form suggests (the field also takes any other kind), and
 * what each usually offers: the examples "See your place on BUKU" shows (3.7i). Names only, never
 * prices, which are each business's own.
 */
export const KINDS_OF_BUSINESS = [
  'Barbershop',
  'Beauty salon',
  'Clinic',
  'Dental clinic',
  'Hospital',
  'Veterinary clinic',
  'Spa',
  'Gym',
  'Laboratory',
  'Bank or office',
] as const;

export type BusinessKind = (typeof KINDS_OF_BUSINESS)[number];

export const EXAMPLE_SERVICES: Record<BusinessKind, readonly [string, string][]> = {
  Barbershop: [
    ['Haircut', '30 min'],
    ['Beard trim', '15 min'],
    ['Hair and beard', '45 min'],
  ],
  'Beauty salon': [
    ['Cut and blow-dry', '60 min'],
    ['Manicure', '30 min'],
    ['Facial', '45 min'],
  ],
  Clinic: [
    ['Consultation', '15 min'],
    ['Follow-up visit', '10 min'],
    ['Vaccination', '10 min'],
  ],
  'Dental clinic': [
    ['Check-up', '20 min'],
    ['Scaling and polishing', '30 min'],
    ['Filling', '40 min'],
  ],
  Hospital: [
    ['OPD consultation', '15 min'],
    ['Lab sample', '10 min'],
    ['Specialist visit', '20 min'],
  ],
  'Veterinary clinic': [
    ['Pet check-up', '20 min'],
    ['Vaccination', '10 min'],
    ['Grooming', '45 min'],
  ],
  Spa: [
    ['Full-body massage', '60 min'],
    ['Foot massage', '30 min'],
    ['Facial', '45 min'],
  ],
  Gym: [
    ['Personal training', '60 min'],
    ['Trial session', '45 min'],
    ['Fitness assessment', '30 min'],
  ],
  Laboratory: [
    ['Blood sample', '10 min'],
    ['Report collection', '5 min'],
    ['Home sample visit', '20 min'],
  ],
  'Bank or office': [
    ['Account opening', '30 min'],
    ['Cash deposit', '10 min'],
    ['Document submission', '15 min'],
  ],
};

export const isBusinessKind = (v: unknown): v is BusinessKind =>
  typeof v === 'string' && (KINDS_OF_BUSINESS as readonly string[]).includes(v);
