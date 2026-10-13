-- The kinds of business that work by appointment or by queue, shipped with the database so every
-- environment has the same list (the dev seed used to be the only place categories came from).
--  * Existing rows are kept as they are: ON CONFLICT DO NOTHING skips any group or kind whose
--    address (slug) or meaning (name_key) is already taken.
--  * name_key follows `categoryKey` in @buku/validation: lower case, "&" read as "and", letters
--    and numbers only, one plural "s" dropped from a longer word.
--  * A kind an owner already added under the same group, still waiting for review, is the same
--    kind as one shipped here: it is approved and takes the shipped name. One added under a
--    different group is left for BUKU to review.
-- Restaurants are left out on purpose: a table booking needs a party size, which services don't have.

INSERT INTO "categories" ("id", "name", "slug", "depth", "sort_order", "name_key") VALUES
  (gen_random_uuid(), 'Beauty & Hair', 'beauty-hair', 0, 0, 'beautyandhair'),
  (gen_random_uuid(), 'Health & Medical', 'health-medical', 0, 1, 'healthandmedical'),
  (gen_random_uuid(), 'Wellness & Spa', 'wellness-spa', 0, 2, 'wellnessandspa'),
  (gen_random_uuid(), 'Fitness', 'fitness', 0, 3, 'fitnes'),
  (gen_random_uuid(), 'Automotive', 'automotive', 0, 4, 'automotive'),
  (gen_random_uuid(), 'Pets', 'pets', 0, 5, 'pet'),
  (gen_random_uuid(), 'Government & Public', 'government-public', 0, 6, 'governmentandpublic'),
  (gen_random_uuid(), 'Home & Professional', 'home-professional', 0, 7, 'homeandprofessional'),
  (gen_random_uuid(), 'Education & Tutoring', 'education-tutoring', 0, 8, 'educationandtutoring'),
  (gen_random_uuid(), 'Events & Photography', 'events-photography', 0, 9, 'eventsandphotography'),
  (gen_random_uuid(), 'Finance & Banking', 'finance-banking', 0, 10, 'financeandbanking')
ON CONFLICT DO NOTHING;

WITH "kinds" ("group_slug", "name", "slug", "sort_order", "name_key") AS (
  VALUES
    ('beauty-hair', 'Barbershop', 'barbershop', 0, 'barbershop'),
    ('beauty-hair', 'Hair Salon', 'hair-salon', 1, 'hairsalon'),
    ('beauty-hair', 'Nail Salon', 'nail-salon', 2, 'nailsalon'),
    ('beauty-hair', 'Beauty Parlour', 'beauty-parlour', 3, 'beautyparlour'),
    ('beauty-hair', 'Bridal Makeup', 'bridal-makeup', 4, 'bridalmakeup'),
    ('beauty-hair', 'Makeup Artist', 'makeup-artist', 5, 'makeupartist'),
    ('beauty-hair', 'Lash & Brow Studio', 'lash-and-brow-studio', 6, 'lashandbrowstudio'),
    ('beauty-hair', 'Waxing & Threading', 'waxing-and-threading', 7, 'waxingandthreading'),
    ('beauty-hair', 'Facial & Skin Care', 'facial-and-skin-care', 8, 'facialandskincare'),
    ('beauty-hair', 'Henna Artist', 'henna-artist', 9, 'hennaartist'),
    ('beauty-hair', 'Tattoo Studio', 'tattoo-studio', 10, 'tattoostudio'),
    ('health-medical', 'Dental Clinic', 'dental-clinic', 0, 'dentalclinic'),
    ('health-medical', 'General Physician', 'general-physician', 1, 'generalphysician'),
    ('health-medical', 'Physiotherapy', 'physiotherapy', 2, 'physiotherapy'),
    ('health-medical', 'Hospital OPD', 'hospital-opd', 3, 'hospitalopd'),
    ('health-medical', 'Dermatologist', 'dermatologist', 4, 'dermatologist'),
    ('health-medical', 'Aesthetic & Laser Clinic', 'aesthetic-and-laser-clinic', 5, 'aestheticandlaserclinic'),
    ('health-medical', 'Eye Clinic', 'eye-clinic', 6, 'eyeclinic'),
    ('health-medical', 'Optician', 'optician', 7, 'optician'),
    ('health-medical', 'Child Specialist', 'child-specialist', 8, 'childspecialist'),
    ('health-medical', 'Gynaecologist', 'gynaecologist', 9, 'gynaecologist'),
    ('health-medical', 'Fertility Clinic', 'fertility-clinic', 10, 'fertilityclinic'),
    ('health-medical', 'Cardiologist', 'cardiologist', 11, 'cardiologist'),
    ('health-medical', 'Orthopaedic Specialist', 'orthopaedic-specialist', 12, 'orthopaedicspecialist'),
    ('health-medical', 'ENT Specialist', 'ent-specialist', 13, 'entspecialist'),
    ('health-medical', 'Psychologist', 'psychologist', 14, 'psychologist'),
    ('health-medical', 'Psychiatrist', 'psychiatrist', 15, 'psychiatrist'),
    ('health-medical', 'Speech Therapy', 'speech-therapy', 16, 'speechtherapy'),
    ('health-medical', 'Nutritionist', 'nutritionist', 17, 'nutritionist'),
    ('health-medical', 'Diagnostic Lab', 'diagnostic-lab', 18, 'diagnosticlab'),
    ('health-medical', 'Radiology & Imaging', 'radiology-and-imaging', 19, 'radiologyandimaging'),
    ('health-medical', 'Chiropractor', 'chiropractor', 20, 'chiropractor'),
    ('health-medical', 'Hearing Clinic', 'hearing-clinic', 21, 'hearingclinic'),
    ('health-medical', 'Vaccination Centre', 'vaccination-centre', 22, 'vaccinationcentre'),
    ('health-medical', 'Homeopathic Clinic', 'homeopathic-clinic', 23, 'homeopathicclinic'),
    ('wellness-spa', 'Spa', 'spa', 0, 'spa'),
    ('wellness-spa', 'Massage', 'massage', 1, 'massage'),
    ('wellness-spa', 'Yoga Studio', 'yoga-studio', 2, 'yogastudio'),
    ('wellness-spa', 'Hijama & Cupping', 'hijama-and-cupping', 3, 'hijamaandcupping'),
    ('wellness-spa', 'Meditation Centre', 'meditation-centre', 4, 'meditationcentre'),
    ('wellness-spa', 'Sauna & Steam Bath', 'sauna-and-steam-bath', 5, 'saunaandsteambath'),
    ('wellness-spa', 'Acupuncture', 'acupuncture', 6, 'acupuncture'),
    ('wellness-spa', 'Reflexology', 'reflexology', 7, 'reflexology'),
    ('fitness', 'Gym', 'gym', 0, 'gym'),
    ('fitness', 'Personal Training', 'personal-training', 1, 'personaltraining'),
    ('fitness', 'Pilates Studio', 'pilates-studio', 2, 'pilatesstudio'),
    ('fitness', 'Martial Arts', 'martial-arts', 3, 'martialart'),
    ('fitness', 'Boxing Gym', 'boxing-gym', 4, 'boxinggym'),
    ('fitness', 'Dance Studio', 'dance-studio', 5, 'dancestudio'),
    ('fitness', 'Swimming Lessons', 'swimming-lessons', 6, 'swimminglesson'),
    ('fitness', 'Padel Court', 'padel-court', 7, 'padelcourt'),
    ('fitness', 'Futsal Ground', 'futsal-ground', 8, 'futsalground'),
    ('fitness', 'Cricket Nets', 'cricket-nets', 9, 'cricketnet'),
    ('fitness', 'Squash Court', 'squash-court', 10, 'squashcourt'),
    ('fitness', 'Tennis Court', 'tennis-court', 11, 'tenniscourt'),
    ('automotive', 'Car Wash', 'car-wash', 0, 'carwash'),
    ('automotive', 'Auto Repair', 'auto-repair', 1, 'autorepair'),
    ('automotive', 'Car Detailing', 'car-detailing', 2, 'cardetailing'),
    ('automotive', 'Oil Change', 'oil-change', 3, 'oilchange'),
    ('automotive', 'Tyres & Alignment', 'tyres-and-alignment', 4, 'tyresandalignment'),
    ('automotive', 'Car AC Repair', 'car-ac-repair', 5, 'caracrepair'),
    ('automotive', 'Body & Paint Shop', 'body-and-paint-shop', 6, 'bodyandpaintshop'),
    ('automotive', 'Vehicle Inspection', 'vehicle-inspection', 7, 'vehicleinspection'),
    ('automotive', 'Motorbike Repair', 'motorbike-repair', 8, 'motorbikerepair'),
    ('automotive', 'Driving School', 'driving-school', 9, 'drivingschool'),
    ('pets', 'Pet Grooming', 'pet-grooming', 0, 'petgrooming'),
    ('pets', 'Veterinary', 'veterinary', 1, 'veterinary'),
    ('pets', 'Pet Boarding', 'pet-boarding', 2, 'petboarding'),
    ('pets', 'Pet Daycare', 'pet-daycare', 3, 'petdaycare'),
    ('pets', 'Dog Training', 'dog-training', 4, 'dogtraining'),
    ('government-public', 'Passport Office', 'passport-office', 0, 'passportoffice'),
    ('government-public', 'Utility Services', 'utility-services', 1, 'utilityservice'),
    ('government-public', 'ID Card Office', 'id-card-office', 2, 'idcardoffice'),
    ('government-public', 'Driving Licence Office', 'driving-licence-office', 3, 'drivinglicenceoffice'),
    ('government-public', 'Excise & Taxation Office', 'excise-and-taxation-office', 4, 'exciseandtaxationoffice'),
    ('government-public', 'Police Verification', 'police-verification', 5, 'policeverification'),
    ('government-public', 'Post Office', 'post-office', 6, 'postoffice'),
    ('government-public', 'Visa Application Centre', 'visa-application-centre', 7, 'visaapplicationcentre'),
    ('government-public', 'Union Council Office', 'union-council-office', 8, 'unioncounciloffice'),
    ('government-public', 'Land Records Office', 'land-records-office', 9, 'landrecordsoffice'),
    ('home-professional', 'Tailor', 'tailor', 0, 'tailor'),
    ('home-professional', 'Legal Consultation', 'legal-consultation', 1, 'legalconsultation'),
    ('home-professional', 'Accountant & Tax Advisor', 'accountant-and-tax-advisor', 2, 'accountantandtaxadvisor'),
    ('home-professional', 'Notary Public', 'notary-public', 3, 'notarypublic'),
    ('home-professional', 'Immigration Consultant', 'immigration-consultant', 4, 'immigrationconsultant'),
    ('home-professional', 'Real Estate Agent', 'real-estate-agent', 5, 'realestateagent'),
    ('home-professional', 'Architect', 'architect', 6, 'architect'),
    ('home-professional', 'Interior Designer', 'interior-designer', 7, 'interiordesigner'),
    ('home-professional', 'Phone & Computer Repair', 'phone-and-computer-repair', 8, 'phoneandcomputerrepair'),
    ('home-professional', 'Mobile Network Service Centre', 'mobile-network-service-centre', 9, 'mobilenetworkservicecentre'),
    ('home-professional', 'Appliance Repair', 'appliance-repair', 10, 'appliancerepair'),
    ('home-professional', 'AC Service', 'ac-service', 11, 'acservice'),
    ('home-professional', 'Plumber', 'plumber', 12, 'plumber'),
    ('home-professional', 'Electrician', 'electrician', 13, 'electrician'),
    ('home-professional', 'Carpenter', 'carpenter', 14, 'carpenter'),
    ('home-professional', 'Home Cleaning', 'home-cleaning', 15, 'homecleaning'),
    ('home-professional', 'Pest Control', 'pest-control', 16, 'pestcontrol'),
    ('home-professional', 'Laundry & Dry Cleaning', 'laundry-and-dry-cleaning', 17, 'laundryanddrycleaning'),
    ('home-professional', 'Printing & Copy Shop', 'printing-and-copy-shop', 18, 'printingandcopyshop'),
    ('education-tutoring', 'Tutoring Centre', 'tutoring-centre', 0, 'tutoringcentre'),
    ('education-tutoring', 'Home Tutor', 'home-tutor', 1, 'hometutor'),
    ('education-tutoring', 'Test Preparation', 'test-preparation', 2, 'testpreparation'),
    ('education-tutoring', 'Language School', 'language-school', 3, 'languageschool'),
    ('education-tutoring', 'Quran Classes', 'quran-classes', 4, 'quranclasse'),
    ('education-tutoring', 'Computer Training', 'computer-training', 5, 'computertraining'),
    ('education-tutoring', 'Music Lessons', 'music-lessons', 6, 'musiclesson'),
    ('education-tutoring', 'Art Classes', 'art-classes', 7, 'artclasse'),
    ('events-photography', 'Photography Studio', 'photography-studio', 0, 'photographystudio'),
    ('events-photography', 'Wedding Photographer', 'wedding-photographer', 1, 'weddingphotographer'),
    ('events-photography', 'Videographer', 'videographer', 2, 'videographer'),
    ('events-photography', 'Event Planner', 'event-planner', 3, 'eventplanner'),
    ('events-photography', 'Wedding Hall & Marquee', 'wedding-hall-and-marquee', 4, 'weddinghallandmarquee'),
    ('finance-banking', 'Bank Branch', 'bank-branch', 0, 'bankbranch'),
    ('finance-banking', 'Currency Exchange', 'currency-exchange', 1, 'currencyexchange'),
    ('finance-banking', 'Insurance Office', 'insurance-office', 2, 'insuranceoffice'),
    ('finance-banking', 'Financial Advisor', 'financial-advisor', 3, 'financialadvisor')
),
"added" AS (
  INSERT INTO "categories" ("id", "name", "slug", "parent_id", "depth", "sort_order", "name_key")
  SELECT gen_random_uuid(), k."name", k."slug", g."id", 1, k."sort_order", k."name_key"
  FROM "kinds" k
  JOIN "categories" g ON g."slug" = k."group_slug" AND g."depth" = 0
  ON CONFLICT DO NOTHING
  RETURNING "id"
)
UPDATE "categories" c
SET "pending" = false, "name" = k."name", "sort_order" = k."sort_order"
FROM "kinds" k
JOIN "categories" g ON g."slug" = k."group_slug" AND g."depth" = 0
WHERE c."name_key" = k."name_key" AND c."parent_id" = g."id" AND c."pending";

-- Every group must be there: a clash on one would quietly leave its kinds out.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(s, ', ') INTO missing
  FROM unnest(ARRAY['beauty-hair', 'health-medical', 'wellness-spa', 'fitness', 'automotive', 'pets',
    'government-public', 'home-professional', 'education-tutoring', 'events-photography',
    'finance-banking']) AS s
  WHERE NOT EXISTS (SELECT 1 FROM "categories" WHERE "slug" = s AND "depth" = 0);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'category groups missing after the insert: %', missing;
  END IF;
END $$;
