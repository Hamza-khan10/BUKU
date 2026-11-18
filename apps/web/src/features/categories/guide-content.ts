/**
 * What each kind of place is, in plain words (D-139): the opening of its page, so every one of
 * BUKU's 127 category pages says something of its own (search engines pass over near-identical
 * pages). General knowledge about the kind of place, never a claim about any business. A test
 * checks every kind in the catalog has one.
 *
 * `visits`: how people mostly come. `book` a time ahead, `queue` walk in and wait their turn, or
 * `both`; it decides which of BUKU's two ways the page leads with.
 */
export type Visits = 'book' | 'queue' | 'both';

export interface KindGuide {
  intro: string;
  /** What people come for, a few words each. */
  book: string[];
  visits: Visits;
}

export const GROUP_GUIDES: Record<string, { intro: string }> = {
  'beauty-hair': {
    intro:
      'Barbers, salons, makeup artists, lash and brow studios, henna and tattoos: the places people book for a cut, a colour or a big day, and the ones they walk into and wait.',
  },
  'health-medical': {
    intro:
      'Doctors, specialists, clinics, labs and hospital outpatient desks. Book a consultation ahead, or take your place in the line for walk-in hours and see it move from where you are.',
  },
  'wellness-spa': {
    intro:
      'Spas, massage, yoga, hijama, steam and quiet hours: time set aside for yourself, booked for the hour that suits you.',
  },
  fitness: {
    intro:
      'Gyms, classes, trainers, and courts and nets to book: a session with a coach, or a slot on the padel, futsal, squash or tennis court.',
  },
  automotive: {
    intro:
      'Washing, servicing, repairs, inspections and driving lessons: book the bay for a time, or join the queue at the wash and wait somewhere better than the forecourt.',
  },
  pets: {
    intro: 'Grooming, vets, boarding, daycare and training for dogs, cats and the rest of the family.',
  },
  'government-public': {
    intro:
      'Offices for passports, ID cards, licences, permits, records and bills: the places with the longest lines, where knowing your turn matters most.',
  },
  'home-professional': {
    intro:
      'Advisers, repairs and services that come to you: lawyers, accountants, tailors, plumbers, electricians, cleaners and more, at a time that works.',
  },
  'education-tutoring': {
    intro:
      'Tutors, lessons, classes and test preparation: a regular time with a teacher, booked and remembered.',
  },
  'events-photography': {
    intro:
      'Photographers, videographers, planners, halls and marquees: the people and places booked for the days that matter.',
  },
  'finance-banking': {
    intro:
      'Banks, exchange, insurance and financial advice: a meeting with an adviser, or your turn at the counter without the wait in the hall.',
  },
};

export const KIND_GUIDES: Record<string, KindGuide> = {
  // Beauty & Hair
  barbershop: {
    intro:
      'A haircut, a fade, a beard trim or a hot-towel shave. Busy barbers run on walk-ins, so knowing your place in line saves the wait on the bench.',
    book: ['Haircuts and fades', 'Beard trims and shaping', 'Hot-towel shaves', 'Kids’ cuts'],
    visits: 'both',
  },
  'hair-salon': {
    intro:
      'Cuts, colour, treatments and styling, where a stylist’s day is planned around bookings and a long colour needs its time held.',
    book: ['Cut and blow-dry', 'Colour and highlights', 'Keratin and treatments', 'Styling for events'],
    visits: 'book',
  },
  'nail-salon': {
    intro:
      'Manicures, pedicures, gel and nail art, booked with the technician you like for the time you have.',
    book: ['Manicures', 'Pedicures', 'Gel and extensions', 'Nail art'],
    visits: 'book',
  },
  'beauty-parlour': {
    intro:
      'The neighbourhood parlour for facials, threading, waxing, hair and party makeup, often busiest on weekends and before weddings.',
    book: ['Facials', 'Threading and waxing', 'Hair cut and styling', 'Party makeup'],
    visits: 'both',
  },
  'bridal-makeup': {
    intro:
      'Bridal and wedding-day makeup, booked weeks ahead, with trials and early-morning starts on the day itself.',
    book: ['Bridal makeup', 'Makeup trials', 'Family and guest makeup', 'Hair styling for the day'],
    visits: 'book',
  },
  'makeup-artist': {
    intro:
      'Makeup for events, shoots and celebrations, at a studio or where you are, booked for the hour before you leave.',
    book: ['Event makeup', 'Shoot makeup', 'Lessons', 'Group bookings'],
    visits: 'book',
  },
  'lash-and-brow-studio': {
    intro:
      'Lash extensions, lifts, brow shaping and tinting: precise work that takes its time, so it is booked.',
    book: ['Lash extensions and refills', 'Lash lifts', 'Brow shaping and tinting', 'Lamination'],
    visits: 'book',
  },
  'waxing-and-threading': {
    intro:
      'Quick visits for threading and waxing, often walked into on the way somewhere, or booked to skip the wait.',
    book: ['Eyebrow threading', 'Face threading', 'Waxing', 'Quick touch-ups'],
    visits: 'both',
  },
  'facial-and-skin-care': {
    intro: 'Facials, cleanups and skin treatments, booked for a set time with the therapist you trust.',
    book: ['Facials', 'Deep cleansing', 'Skin treatments', 'Consultations'],
    visits: 'book',
  },
  'henna-artist': {
    intro:
      'Henna for weddings, Eid and celebrations, at a studio or at home, with the busiest nights booked well ahead.',
    book: ['Bridal henna', 'Party and Eid henna', 'Home visits', 'Group bookings'],
    visits: 'book',
  },
  'tattoo-studio': {
    intro:
      'Consultations, custom designs and sessions with an artist, booked by the hour, with touch-ups after.',
    book: ['Consultations', 'Tattoo sessions', 'Touch-ups', 'Piercings'],
    visits: 'book',
  },

  // Health & Medical
  'dental-clinic': {
    intro:
      'Check-ups, cleaning, fillings, root canals and braces: dental visits planned around the chair’s day, with emergencies fitted in.',
    book: [
      'Check-ups and cleaning',
      'Fillings and root canals',
      'Braces and aligners consultations',
      'Extractions',
    ],
    visits: 'book',
  },
  'general-physician': {
    intro:
      'The family doctor for fevers, check-ups, prescriptions and referrals, often with walk-in hours where the waiting room fills up fast.',
    book: ['Consultations', 'Follow-ups', 'Check-ups', 'Prescriptions and referrals'],
    visits: 'both',
  },
  physiotherapy: {
    intro:
      'Sessions for pain, injuries and recovery after surgery, usually a course of visits booked at regular times.',
    book: ['Assessments', 'Physiotherapy sessions', 'Sports injury care', 'Rehabilitation'],
    visits: 'book',
  },
  'hospital-opd': {
    intro:
      'Outpatient departments where patients take a token and wait to be called. Seeing the line move from home means less time in a crowded hall.',
    book: ['OPD consultations', 'Specialist clinics', 'Follow-up visits', 'Tokens for walk-in hours'],
    visits: 'queue',
  },
  dermatologist: {
    intro:
      'Skin, hair and nail problems, from acne and allergies to hair loss, seen by appointment or in the evening clinic’s line.',
    book: ['Skin consultations', 'Acne and allergy care', 'Hair loss consultations', 'Follow-ups'],
    visits: 'both',
  },
  'aesthetic-and-laser-clinic': {
    intro: 'Laser hair removal, skin treatments and aesthetic procedures, planned as sessions at set times.',
    book: ['Laser hair removal', 'Skin resurfacing', 'Consultations', 'Treatment sessions'],
    visits: 'book',
  },
  'eye-clinic': {
    intro:
      'Eye tests, consultations and treatment with an eye specialist, by appointment or in walk-in hours.',
    book: ['Eye examinations', 'Specialist consultations', 'Follow-ups', 'Surgery consultations'],
    visits: 'both',
  },
  optician: {
    intro: 'Sight tests, glasses and contact lenses, where a test is booked and collection is a quick visit.',
    book: ['Sight tests', 'Contact lens fittings', 'Frame fittings', 'Collections'],
    visits: 'both',
  },
  'child-specialist': {
    intro:
      'A paediatrician for check-ups, vaccines, fevers and growth, where a shorter wait matters most with a child in your arms.',
    book: ['Child consultations', 'Well-baby check-ups', 'Vaccination visits', 'Follow-ups'],
    visits: 'both',
  },
  gynaecologist: {
    intro:
      'Consultations, pregnancy check-ups and women’s health, booked so the visit is on time and private.',
    book: ['Consultations', 'Pregnancy check-ups', 'Scans and follow-ups', 'Family planning'],
    visits: 'book',
  },
  'fertility-clinic': {
    intro:
      'Consultations, tests and treatment cycles, where timing matters and appointments follow a careful plan.',
    book: ['Consultations', 'Tests and scans', 'Treatment visits', 'Counselling'],
    visits: 'book',
  },
  cardiologist: {
    intro:
      'Heart check-ups, ECGs and consultations with a heart specialist, by appointment or in clinic hours.',
    book: ['Consultations', 'ECG and check-ups', 'Follow-ups', 'Test reviews'],
    visits: 'both',
  },
  'orthopaedic-specialist': {
    intro:
      'Bones, joints, backs and sports injuries, seen by a specialist by appointment or in the clinic’s line.',
    book: ['Consultations', 'Fracture and injury follow-ups', 'Joint and back pain', 'Post-surgery reviews'],
    visits: 'both',
  },
  'ent-specialist': {
    intro:
      'Ear, nose and throat problems, from sinus and allergies to hearing, seen by appointment or in walk-in hours.',
    book: ['Consultations', 'Ear cleaning', 'Sinus and allergy care', 'Follow-ups'],
    visits: 'both',
  },
  psychologist: {
    intro: 'Therapy and counselling sessions, booked regularly and kept private.',
    book: ['First consultations', 'Therapy sessions', 'Couples and family sessions', 'Assessments'],
    visits: 'book',
  },
  psychiatrist: {
    intro: 'Consultations and medication reviews with a psychiatrist, at times booked ahead.',
    book: ['Consultations', 'Medication reviews', 'Follow-ups', 'Assessments'],
    visits: 'book',
  },
  'speech-therapy': {
    intro:
      'Sessions for speech, language and swallowing, for children and adults, usually a course at fixed times.',
    book: ['Assessments', 'Therapy sessions', 'Children’s sessions', 'Progress reviews'],
    visits: 'book',
  },
  nutritionist: {
    intro: 'Diet plans, weight management and nutrition for health conditions, with regular check-ins.',
    book: ['Consultations', 'Diet plans', 'Weight check-ins', 'Follow-ups'],
    visits: 'book',
  },
  'diagnostic-lab': {
    intro:
      'Blood tests, samples and health checks, where mornings get busy and fasting tests can’t wait long.',
    book: ['Blood tests', 'Sample collection', 'Health check packages', 'Home sampling'],
    visits: 'both',
  },
  'radiology-and-imaging': {
    intro:
      'X-rays, ultrasounds, CT and MRI scans, booked for a slot so the machine and the patient are ready together.',
    book: ['X-rays', 'Ultrasounds', 'CT scans', 'MRI scans'],
    visits: 'both',
  },
  chiropractor: {
    intro: 'Spine and joint adjustments for back and neck pain, booked as a course of sessions.',
    book: ['Assessments', 'Adjustments', 'Back and neck care', 'Follow-ups'],
    visits: 'book',
  },
  'hearing-clinic': {
    intro: 'Hearing tests, hearing aids and follow-up care, by appointment.',
    book: ['Hearing tests', 'Hearing aid fittings', 'Adjustments', 'Follow-ups'],
    visits: 'book',
  },
  'vaccination-centre': {
    intro: 'Vaccines for children, adults and travel, where a walk-in line forms on busy days.',
    book: ['Childhood vaccines', 'Adult vaccines', 'Travel vaccines', 'Certificates'],
    visits: 'both',
  },
  'homeopathic-clinic': {
    intro: 'Consultations and follow-ups with a homeopath, by appointment or in clinic hours.',
    book: ['Consultations', 'Follow-ups', 'Remedy reviews', 'Family visits'],
    visits: 'both',
  },

  // Wellness & Spa
  spa: {
    intro: 'Massages, body treatments and spa packages, booked for an hour that is entirely yours.',
    book: ['Massages', 'Body treatments', 'Spa packages', 'Couples’ sessions'],
    visits: 'book',
  },
  massage: {
    intro:
      'Relaxing, deep-tissue and therapeutic massage, booked with the therapist and the length you want.',
    book: ['Relaxing massage', 'Deep-tissue massage', 'Sports massage', 'Head and shoulders'],
    visits: 'book',
  },
  'yoga-studio': {
    intro: 'Classes for every level, private sessions and workshops, where a class has only so many mats.',
    book: ['Group classes', 'Private sessions', 'Beginners’ courses', 'Workshops'],
    visits: 'book',
  },
  'hijama-and-cupping': {
    intro: 'Hijama and cupping therapy, often booked for particular days, for men and women.',
    book: ['Hijama', 'Dry cupping', 'Wet cupping', 'Follow-up sessions'],
    visits: 'book',
  },
  'meditation-centre': {
    intro: 'Guided meditation, breathing and quiet sessions, in groups or one to one.',
    book: ['Guided sessions', 'Group sittings', 'Courses', 'One-to-one sessions'],
    visits: 'book',
  },
  'sauna-and-steam-bath': {
    intro:
      'Sauna and steam sessions with limited room, booked for a time or joined as a line on busy evenings.',
    book: ['Sauna sessions', 'Steam sessions', 'Private hours', 'Packages'],
    visits: 'both',
  },
  acupuncture: {
    intro: 'Acupuncture for pain, stress and recovery, booked as a course of sessions.',
    book: ['Consultations', 'Acupuncture sessions', 'Pain care', 'Follow-ups'],
    visits: 'book',
  },
  reflexology: {
    intro: 'Foot and hand reflexology sessions, booked for the time you need to switch off.',
    book: ['Foot reflexology', 'Hand reflexology', 'Combined sessions', 'Packages'],
    visits: 'book',
  },

  // Fitness
  gym: {
    intro:
      'Memberships, inductions, classes and personal sessions, where the right time means a free machine.',
    book: ['Inductions', 'Classes', 'Personal training', 'Day passes'],
    visits: 'both',
  },
  'personal-training': {
    intro: 'One-to-one training with a coach, booked at regular times so the plan keeps going.',
    book: ['Assessments', 'One-to-one sessions', 'Small-group sessions', 'Programme reviews'],
    visits: 'book',
  },
  'pilates-studio': {
    intro: 'Mat and reformer classes and private sessions, with only so many reformers in the room.',
    book: ['Reformer classes', 'Mat classes', 'Private sessions', 'Beginners’ courses'],
    visits: 'book',
  },
  'martial-arts': {
    intro: 'Karate, taekwondo, MMA and self-defence classes for children and adults.',
    book: ['Trial classes', 'Regular classes', 'Private lessons', 'Grading sessions'],
    visits: 'book',
  },
  'boxing-gym': {
    intro: 'Boxing classes, pad work and one-to-one coaching, for fitness or for the ring.',
    book: ['Classes', 'Pad sessions', 'One-to-one coaching', 'Trial sessions'],
    visits: 'book',
  },
  'dance-studio': {
    intro: 'Dance classes and private lessons, from beginners to wedding choreography.',
    book: ['Group classes', 'Private lessons', 'Wedding choreography', 'Children’s classes'],
    visits: 'book',
  },
  'swimming-lessons': {
    intro:
      'Swimming lessons for children and adults, in small groups or one to one, at set times in the pool.',
    book: ['Children’s lessons', 'Adult lessons', 'Private lessons', 'Pool time'],
    visits: 'book',
  },
  'padel-court': {
    intro: 'Padel courts booked by the hour, with coaching sessions for newcomers.',
    book: ['Court hire by the hour', 'Coaching', 'Group sessions', 'Evening slots'],
    visits: 'book',
  },
  'futsal-ground': {
    intro: 'Futsal and five-a-side grounds booked by the hour, with evenings and weekends going first.',
    book: ['Ground hire by the hour', 'Weekly slots', 'Tournaments', 'Coaching'],
    visits: 'book',
  },
  'cricket-nets': {
    intro: 'Cricket nets booked by the hour for batting and bowling practice, with coaching on request.',
    book: ['Net hire by the hour', 'Bowling machine time', 'Coaching', 'Team practice'],
    visits: 'book',
  },
  'squash-court': {
    intro: 'Squash courts booked by the hour, with coaching and club nights.',
    book: ['Court hire', 'Coaching', 'Club sessions', 'Peak-time slots'],
    visits: 'book',
  },
  'tennis-court': {
    intro: 'Tennis courts by the hour, lessons and practice sessions.',
    book: ['Court hire', 'Lessons', 'Group coaching', 'Practice slots'],
    visits: 'book',
  },

  // Automotive
  'car-wash': {
    intro:
      'Washes, vacuuming and quick polishing, where a weekend line of cars forms fast. Join it from your phone and arrive when it’s your turn.',
    book: ['Exterior wash', 'Interior vacuuming', 'Full wash', 'Quick polish'],
    visits: 'both',
  },
  'auto-repair': {
    intro: 'Servicing, diagnostics and repairs, booked so the car goes in when a mechanic is free.',
    book: ['Servicing', 'Diagnostics', 'Repairs', 'Pre-purchase checks'],
    visits: 'book',
  },
  'car-detailing': {
    intro: 'Detailing, ceramic coating and paint correction: hours of work, booked for a full slot.',
    book: ['Full detailing', 'Ceramic coating', 'Paint correction', 'Interior detailing'],
    visits: 'book',
  },
  'oil-change': {
    intro: 'Oil and filter changes and quick checks, done while you wait or in a line you can watch.',
    book: ['Oil and filter change', 'Fluid top-ups', 'Quick checks', 'Battery checks'],
    visits: 'both',
  },
  'tyres-and-alignment': {
    intro: 'Tyre fitting, wheel alignment and balancing, booked for a bay or joined as a line.',
    book: ['Tyre fitting', 'Wheel alignment', 'Balancing', 'Puncture repair'],
    visits: 'both',
  },
  'car-ac-repair': {
    intro: 'Car air-conditioning checks, gas refills and repairs, busiest in the hottest months.',
    book: ['AC checks', 'Gas refills', 'Repairs', 'Compressor service'],
    visits: 'both',
  },
  'body-and-paint-shop': {
    intro: 'Dent repair, painting and accident work, starting with an inspection and an estimate.',
    book: ['Inspections and estimates', 'Dent repair', 'Painting', 'Accident repairs'],
    visits: 'book',
  },
  'vehicle-inspection': {
    intro: 'Vehicle inspections and fitness checks, where a booked slot means less time waiting in line.',
    book: ['Inspections', 'Fitness certificates', 'Re-tests', 'Pre-purchase inspections'],
    visits: 'both',
  },
  'motorbike-repair': {
    intro: 'Motorbike servicing, tuning and repairs, often walked into and waited for.',
    book: ['Servicing', 'Tuning', 'Repairs', 'Oil changes'],
    visits: 'queue',
  },
  'driving-school': {
    intro: 'Driving lessons with an instructor, booked at regular times, and test preparation.',
    book: ['Driving lessons', 'Test preparation', 'Refresher lessons', 'Assessments'],
    visits: 'book',
  },

  // Pets
  'pet-grooming': {
    intro: 'Baths, haircuts, nail trims and full grooming for dogs and cats, booked by size and time.',
    book: ['Bath and dry', 'Haircuts', 'Nail trims', 'Full grooming'],
    visits: 'book',
  },
  veterinary: {
    intro: 'Check-ups, vaccines and treatment for pets, by appointment or in the clinic’s walk-in hours.',
    book: ['Check-ups', 'Vaccinations', 'Treatment visits', 'Follow-ups'],
    visits: 'both',
  },
  'pet-boarding': {
    intro: 'Overnight stays for pets while you travel, booked for the dates you need.',
    book: ['Overnight stays', 'Long stays', 'Drop-off and pick-up', 'Meet-and-greet visits'],
    visits: 'book',
  },
  'pet-daycare': {
    intro: 'Daytime care and play for dogs, booked for the days you are out.',
    book: ['Full days', 'Half days', 'Trial days', 'Regular weekly days'],
    visits: 'book',
  },
  'dog-training': {
    intro: 'Training for puppies and dogs, in classes or one to one, at regular times.',
    book: ['Puppy classes', 'Obedience training', 'One-to-one sessions', 'Behaviour consultations'],
    visits: 'book',
  },

  // Government & Public
  'passport-office': {
    intro:
      'New passports, renewals and corrections: some of the longest lines anywhere. See your place and arrive when your turn is near.',
    book: ['New passports', 'Renewals', 'Corrections', 'Collections'],
    visits: 'queue',
  },
  'utility-services': {
    intro:
      'Electricity, gas and water offices for bills, complaints and new connections, where the counter line can take the morning.',
    book: ['Bill queries', 'Complaints', 'New connections', 'Name and address changes'],
    visits: 'queue',
  },
  'id-card-office': {
    intro:
      'National ID cards, renewals and family records, at offices known for long waits. A place in line you can watch makes the visit shorter.',
    book: ['New ID cards', 'Renewals', 'Corrections', 'Family records'],
    visits: 'queue',
  },
  'driving-licence-office': {
    intro:
      'Learner permits, tests, renewals and international licences, with lines and test slots to wait for.',
    book: ['Learner permits', 'Driving tests', 'Renewals', 'International licences'],
    visits: 'queue',
  },
  'excise-and-taxation-office': {
    intro: 'Vehicle registration, transfers, number plates and property tax, at counters with long waits.',
    book: ['Vehicle registration', 'Transfers', 'Number plates', 'Tax payments'],
    visits: 'queue',
  },
  'police-verification': {
    intro: 'Character certificates and police verification, where the line moves slowly and a token helps.',
    book: ['Character certificates', 'Verification', 'Tenant registration', 'Collections'],
    visits: 'queue',
  },
  'post-office': {
    intro: 'Parcels, letters, bill payments and savings, at counters that queue up at the busiest hours.',
    book: ['Parcels and letters', 'Bill payments', 'Savings services', 'Collections'],
    visits: 'queue',
  },
  'visa-application-centre': {
    intro: 'Visa submissions, biometrics and collections, usually by appointment, with a line on the day.',
    book: ['Submissions', 'Biometrics', 'Collections', 'Document checks'],
    visits: 'both',
  },
  'union-council-office': {
    intro:
      'Birth, marriage and death certificates and local records, at offices where the wait is unpredictable.',
    book: ['Birth certificates', 'Marriage certificates', 'Death certificates', 'Local records'],
    visits: 'queue',
  },
  'land-records-office': {
    intro: 'Land records, ownership documents and transfers, where knowing your turn saves a day.',
    book: ['Record copies', 'Ownership documents', 'Transfers', 'Verification'],
    visits: 'queue',
  },

  // Home & Professional
  tailor: {
    intro:
      'Measurements, stitching, alterations and fittings, with the busiest weeks before Eid and weddings.',
    book: ['Measurements', 'Stitching', 'Alterations', 'Fittings'],
    visits: 'both',
  },
  'legal-consultation': {
    intro: 'Consultations with a lawyer about property, family, business or disputes, booked privately.',
    book: ['Consultations', 'Document reviews', 'Follow-ups', 'Case discussions'],
    visits: 'book',
  },
  'accountant-and-tax-advisor': {
    intro: 'Tax returns, bookkeeping and business advice, with the busiest weeks before filing deadlines.',
    book: ['Tax returns', 'Consultations', 'Bookkeeping reviews', 'Business registration'],
    visits: 'book',
  },
  'notary-public': {
    intro: 'Attestations, affidavits and stamped documents, often a short visit with a line in front of it.',
    book: ['Attestations', 'Affidavits', 'Agreements', 'Document stamping'],
    visits: 'both',
  },
  'immigration-consultant': {
    intro: 'Advice on study, work and family visas and applications, booked as consultations.',
    book: ['Consultations', 'Application reviews', 'Document preparation', 'Follow-ups'],
    visits: 'book',
  },
  'real-estate-agent': {
    intro: 'Viewings and meetings to buy, sell or rent, booked around the property and the people.',
    book: ['Property viewings', 'Consultations', 'Valuations', 'Rental meetings'],
    visits: 'book',
  },
  architect: {
    intro: 'Design consultations, site visits and plans for homes and buildings.',
    book: ['Consultations', 'Site visits', 'Design reviews', 'Planning meetings'],
    visits: 'book',
  },
  'interior-designer': {
    intro: 'Consultations, home visits and design plans for rooms, homes and shops.',
    book: ['Consultations', 'Home visits', 'Design reviews', 'Material selection'],
    visits: 'book',
  },
  'phone-and-computer-repair': {
    intro: 'Screen, battery and software repairs for phones and laptops, often walked into and waited for.',
    book: ['Screen repairs', 'Battery replacements', 'Software fixes', 'Diagnostics'],
    visits: 'both',
  },
  'mobile-network-service-centre': {
    intro:
      'SIM replacements, registrations and account help from your mobile network, at counters with a line.',
    book: ['SIM replacements', 'Registrations', 'Account help', 'Device services'],
    visits: 'queue',
  },
  'appliance-repair': {
    intro: 'Repairs for fridges, washing machines and other appliances, at the shop or at home.',
    book: ['Home visits', 'Repairs', 'Servicing', 'Inspections'],
    visits: 'book',
  },
  'ac-service': {
    intro: 'Air-conditioner servicing, gas refills and installation, booked well ahead of summer.',
    book: ['AC servicing', 'Gas refills', 'Installation', 'Repairs'],
    visits: 'book',
  },
  plumber: {
    intro: 'Leaks, fittings, water tanks and new installations, with a visit booked for a time you’re home.',
    book: ['Leak repairs', 'Fittings', 'Installations', 'Inspections'],
    visits: 'book',
  },
  electrician: {
    intro: 'Wiring, faults, fittings and installations, with a visit booked for a time that suits you.',
    book: ['Fault repairs', 'Wiring', 'Fittings', 'Installations'],
    visits: 'book',
  },
  carpenter: {
    intro: 'Furniture, doors, fittings and repairs, starting with a visit to measure.',
    book: ['Measurements', 'Repairs', 'Custom furniture', 'Fittings'],
    visits: 'book',
  },
  'home-cleaning': {
    intro: 'Regular cleaning, deep cleans and move-in or move-out cleaning, booked for a day and time.',
    book: ['Regular cleaning', 'Deep cleaning', 'Move-in and move-out cleaning', 'Sofa and carpet cleaning'],
    visits: 'book',
  },
  'pest-control': {
    intro:
      'Treatment for termites, insects and rodents at homes and businesses, starting with an inspection.',
    book: ['Inspections', 'Treatments', 'Termite proofing', 'Follow-up visits'],
    visits: 'book',
  },
  'laundry-and-dry-cleaning': {
    intro: 'Washing, ironing and dry cleaning, with drop-offs and collections at times that suit you.',
    book: ['Drop-offs', 'Collections', 'Dry cleaning', 'Ironing'],
    visits: 'both',
  },
  'printing-and-copy-shop': {
    intro: 'Printing, photocopies, binding and photos, usually a quick visit with a line at busy hours.',
    book: ['Printing', 'Photocopies', 'Binding', 'Passport photos'],
    visits: 'queue',
  },

  // Education & Tutoring
  'tutoring-centre': {
    intro: 'Tuition for school and college subjects in small groups, at times that fit around school.',
    book: ['Subject classes', 'Trial classes', 'Exam revision', 'Progress meetings'],
    visits: 'book',
  },
  'home-tutor': {
    intro: 'One-to-one tutoring at home or online, booked at a regular time each week.',
    book: ['One-to-one lessons', 'Trial lessons', 'Exam preparation', 'Online sessions'],
    visits: 'book',
  },
  'test-preparation': {
    intro:
      'Preparation for entry tests, IELTS, SAT and other exams, with classes and mock tests on a schedule.',
    book: ['Classes', 'Mock tests', 'One-to-one coaching', 'Counselling'],
    visits: 'book',
  },
  'language-school': {
    intro: 'English and other language classes, conversation practice and exam courses.',
    book: ['Group classes', 'Private lessons', 'Placement tests', 'Exam courses'],
    visits: 'book',
  },
  'quran-classes': {
    intro: 'Quran reading, tajweed and memorisation classes for children and adults, in person or online.',
    book: ['Reading classes', 'Tajweed', 'Memorisation', 'Online classes'],
    visits: 'book',
  },
  'computer-training': {
    intro: 'Computer courses, from basics to office skills, design and programming.',
    book: ['Courses', 'Trial classes', 'Private lessons', 'Certification preparation'],
    visits: 'book',
  },
  'music-lessons': {
    intro: 'Lessons for guitar, keyboard, vocals and more, one to one at regular times.',
    book: ['Instrument lessons', 'Vocal lessons', 'Trial lessons', 'Group classes'],
    visits: 'book',
  },
  'art-classes': {
    intro: 'Drawing, painting and calligraphy classes for children and adults.',
    book: ['Classes', 'Workshops', 'Private lessons', 'Children’s sessions'],
    visits: 'book',
  },

  // Events & Photography
  'photography-studio': {
    intro: 'Portraits, family photos, product shoots and passport photos, booked for a session.',
    book: ['Portrait sessions', 'Family photos', 'Product shoots', 'Passport photos'],
    visits: 'both',
  },
  'wedding-photographer': {
    intro: 'Wedding and event photography, booked months ahead, with a meeting to plan the day.',
    book: ['Consultations', 'Wedding coverage', 'Engagement shoots', 'Event coverage'],
    visits: 'book',
  },
  videographer: {
    intro: 'Event films, wedding highlights and video shoots, planned and booked ahead.',
    book: ['Consultations', 'Event filming', 'Wedding films', 'Promotional shoots'],
    visits: 'book',
  },
  'event-planner': {
    intro: 'Planning weddings, birthdays and corporate events, starting with a meeting.',
    book: ['Consultations', 'Planning meetings', 'Venue visits', 'Event-day coordination'],
    visits: 'book',
  },
  'wedding-hall-and-marquee': {
    intro:
      'Halls and marquees for weddings and functions, with visits to see the place and dates that go fast.',
    book: ['Venue visits', 'Date bookings', 'Menu tastings', 'Planning meetings'],
    visits: 'book',
  },

  // Finance & Banking
  'bank-branch': {
    intro:
      'Accounts, cards, cash and loans at the branch, where the line for the counter can take an hour. Take your turn from your phone.',
    book: ['Account opening', 'Counter services', 'Card services', 'Meetings with an officer'],
    visits: 'both',
  },
  'currency-exchange': {
    intro: 'Buying and selling foreign currency, a quick visit with a line before travel season.',
    book: ['Buying currency', 'Selling currency', 'Rate enquiries', 'Large orders'],
    visits: 'queue',
  },
  'insurance-office': {
    intro: 'Policies, claims and renewals for health, car, life and home insurance.',
    book: ['Policy consultations', 'Claims', 'Renewals', 'Document submissions'],
    visits: 'both',
  },
  'financial-advisor': {
    intro: 'Advice on savings, investments, retirement and planning, booked as private meetings.',
    book: ['Consultations', 'Portfolio reviews', 'Retirement planning', 'Follow-ups'],
    visits: 'book',
  },
};
