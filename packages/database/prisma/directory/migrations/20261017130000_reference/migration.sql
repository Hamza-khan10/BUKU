-- Reference data (docs/DATABASE.md DB-015): currencies, kinds of business, plans and prices,
-- billing and notification settings. The directory holds the truth and publishes it
-- (`buku_reference`); every business shard and the catalog keep read-only copies, so joins with
-- it stay local. Generated part first, then the rules, the data v1 left, and the publication.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reference";

-- CreateTable
CREATE TABLE "reference"."currencies" (
    "code" CHAR(3) NOT NULL,
    "exponent" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "reference"."categories" (
    "id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "suggested_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depth" SMALLINT NOT NULL DEFAULT 0,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(120),
    "icon" VARCHAR(10),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."plans" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(50) NOT NULL,
    "audience" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "tagline" VARCHAR(200),
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "external_product_id" VARCHAR(200),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."plan_prices" (
    "id" BIGINT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "trial_days" SMALLINT NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "channel" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" VARCHAR(10) NOT NULL DEFAULT 'month',
    "external_price_id" VARCHAR(200),

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."billing_settings" (
    "audience" VARCHAR(10) NOT NULL,
    "default_plan_id" BIGINT NOT NULL,
    "plan_when_disabled_id" BIGINT NOT NULL,
    "trial_plan_id" BIGINT,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_days" SMALLINT NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trial_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("audience")
);

-- CreateTable
CREATE TABLE "reference"."billing_channel_fees" (
    "channel" VARCHAR(10) NOT NULL,
    "fixed_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "percent" DECIMAL(5,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" VARCHAR(300),

    CONSTRAINT "billing_channel_fees_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "reference"."billing_cost_items" (
    "id" BIGINT NOT NULL,
    "monthly_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "category" VARCHAR(30) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "name" VARCHAR(100) NOT NULL,
    "notes" VARCHAR(300),

    CONSTRAINT "billing_cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."notification_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsapp_monthly_budget_cents" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_free_window_per_month" INTEGER NOT NULL DEFAULT 1000,
    "whatsapp_message_cost_cents" DECIMAL(8,4) NOT NULL DEFAULT 4,
    "quiet_start_hour" SMALLINT NOT NULL DEFAULT 21,
    "quiet_end_hour" SMALLINT NOT NULL DEFAULT 9,
    "suggestion_min_days" SMALLINT NOT NULL DEFAULT 7,
    "suggestion_max_per_30_days" SMALLINT NOT NULL DEFAULT 3,
    "suggestion_max_ignored" SMALLINT NOT NULL DEFAULT 3,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder_2h" BOOLEAN NOT NULL DEFAULT true,
    "suggestions_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_paid_types" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "reference"."categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key_key" ON "reference"."categories"("name_key");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "reference"."categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "reference"."plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plans_external_product_id_key" ON "reference"."plans"("external_product_id");

-- CreateIndex
CREATE INDEX "plans_audience_archived_at_idx" ON "reference"."plans"("audience", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_external_price_id_key" ON "reference"."plan_prices"("external_price_id");

-- CreateIndex
CREATE INDEX "plan_prices_plan_id_archived_at_idx" ON "reference"."plan_prices"("plan_id", "archived_at");

-- CreateIndex
CREATE INDEX "plan_prices_currency_idx" ON "reference"."plan_prices"("currency");

-- CreateIndex
CREATE INDEX "billing_settings_default_plan_id_idx" ON "reference"."billing_settings"("default_plan_id");

-- CreateIndex
CREATE INDEX "billing_settings_plan_when_disabled_id_idx" ON "reference"."billing_settings"("plan_when_disabled_id");

-- CreateIndex
CREATE INDEX "billing_settings_trial_plan_id_idx" ON "reference"."billing_settings"("trial_plan_id");

-- AddForeignKey
ALTER TABLE "reference"."categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "reference"."categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference"."plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "reference"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference"."plan_prices" ADD CONSTRAINT "plan_prices_currency_fkey" FOREIGN KEY ("currency") REFERENCES "reference"."currencies"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference"."billing_settings" ADD CONSTRAINT "billing_settings_default_plan_id_fkey" FOREIGN KEY ("default_plan_id") REFERENCES "reference"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference"."billing_settings" ADD CONSTRAINT "billing_settings_plan_when_disabled_id_fkey" FOREIGN KEY ("plan_when_disabled_id") REFERENCES "reference"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference"."billing_settings" ADD CONSTRAINT "billing_settings_trial_plan_id_fkey" FOREIGN KEY ("trial_plan_id") REFERENCES "reference"."plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 Rules Prisma can't express \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

ALTER TABLE "reference"."currencies"
  ADD CONSTRAINT "currencies_code_format" CHECK ("code" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "currencies_exponent" CHECK ("exponent" BETWEEN 0 AND 4),
  ADD CONSTRAINT "currencies_name_present" CHECK (length(btrim("name")) >= 1);

-- A kind of business is shared by everyone, so its name is held to what can't harm anyone, even
-- if it arrives by another way than the API (which allows letters of any script, numbers, spaces
-- and & ' - only): no control or invisible characters, no characters used in markup or code, no
-- emoji or pictographs, no stray spaces, at least two letters.
ALTER TABLE "reference"."categories"
  ADD CONSTRAINT "categories_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "categories_tree" CHECK (
    "depth" BETWEEN 0 AND 1 AND ("parent_id" IS NULL) = ("depth" = 0) AND "parent_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "categories_name_clean" CHECK (
    length("name") BETWEEN 2 AND 100 AND "name" = btrim("name") AND "name" !~ '  '
    AND "name" ~ '[[:alpha:]].*[[:alpha:]]'
    AND "name" !~ '[[:cntrl:]\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]'
    AND "name" !~ '[<>{}\[\]\\/"`;$#@!%^*=+|~?:]'
    AND "name" !~ '[\u2190-\u2BFF\uFE0F\U0001F000-\U0001FAFF]'),
  ADD CONSTRAINT "categories_name_key_clean" CHECK ("name_key" IS NULL OR (
    length("name_key") BETWEEN 1 AND 120 AND "name_key" !~ '[[:space:][:cntrl:]]'
    AND "name_key" !~ '[<>{}\[\]\\/"`;$#@!%^*=+|~?:&''\u2019-]')),
  -- A pending kind is an owner's suggestion, waiting for review.
  ADD CONSTRAINT "categories_pending_suggested" CHECK (NOT "pending" OR "suggested_by_id" IS NOT NULL);

ALTER TABLE "reference"."plans"
  ADD CONSTRAINT "plans_code_format" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,49}$'),
  ADD CONSTRAINT "plans_audience" CHECK ("audience" IN ('user', 'business')),
  ADD CONSTRAINT "plans_name_present" CHECK (length(btrim("name")) >= 1);
ALTER TABLE "reference"."plan_prices"
  ADD CONSTRAINT "plan_prices_amount" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "plan_prices_channel" CHECK ("channel" IN ('web', 'android', 'ios')),
  ADD CONSTRAINT "plan_prices_interval" CHECK ("interval" IN ('month', 'year')),
  ADD CONSTRAINT "plan_prices_trial" CHECK ("trial_days" BETWEEN 0 AND 365);
ALTER TABLE "reference"."billing_settings"
  ADD CONSTRAINT "billing_settings_audience" CHECK ("audience" IN ('user', 'business')),
  ADD CONSTRAINT "billing_settings_trial" CHECK ("trial_days" BETWEEN 1 AND 365);
ALTER TABLE "reference"."billing_channel_fees"
  ADD CONSTRAINT "billing_channel_fees_channel" CHECK ("channel" IN ('web', 'android', 'ios')),
  ADD CONSTRAINT "billing_channel_fees_amounts" CHECK ("percent" BETWEEN 0 AND 100 AND "fixed_minor" >= 0),
  ADD CONSTRAINT "billing_channel_fees_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "reference"."billing_cost_items"
  ADD CONSTRAINT "billing_cost_items_amount" CHECK ("monthly_minor" >= 0),
  ADD CONSTRAINT "billing_cost_items_category" CHECK ("category" IN ('infrastructure', 'messaging', 'software', 'other')),
  ADD CONSTRAINT "billing_cost_items_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "reference"."notification_settings"
  ADD CONSTRAINT "notification_settings_one_row" CHECK ("id" = 1),
  ADD CONSTRAINT "notification_settings_ranges" CHECK (
    "quiet_start_hour" BETWEEN 0 AND 23 AND "quiet_end_hour" BETWEEN 0 AND 23
    AND "whatsapp_monthly_budget_cents" >= 0 AND "whatsapp_message_cost_cents" >= 0
    AND "whatsapp_free_window_per_month" >= 0 AND "suggestion_min_days" >= 1
    AND "suggestion_max_per_30_days" >= 1 AND "suggestion_max_ignored" >= 1);

-- ═══════════════════════ The data (as v1 left it) ═══════════════════════

-- Currencies people pay in where BUKU is or will soon be, with their ISO 4217 minor units.
INSERT INTO "reference"."currencies" ("code", "exponent", "name") VALUES
  ('PKR', 2, 'Pakistani rupee'), ('USD', 2, 'US dollar'), ('EUR', 2, 'Euro'), ('GBP', 2, 'Pound sterling'),
  ('AED', 2, 'UAE dirham'), ('SAR', 2, 'Saudi riyal'), ('QAR', 2, 'Qatari riyal'), ('KWD', 3, 'Kuwaiti dinar'),
  ('BHD', 3, 'Bahraini dinar'), ('OMR', 3, 'Omani rial'), ('JOD', 3, 'Jordanian dinar'), ('INR', 2, 'Indian rupee'),
  ('BDT', 2, 'Bangladeshi taka'), ('LKR', 2, 'Sri Lankan rupee'), ('NPR', 2, 'Nepalese rupee'),
  ('AFN', 2, 'Afghan afghani'), ('CNY', 2, 'Chinese yuan'), ('JPY', 0, 'Japanese yen'), ('KRW', 0, 'South Korean won'),
  ('MYR', 2, 'Malaysian ringgit'), ('SGD', 2, 'Singapore dollar'), ('IDR', 2, 'Indonesian rupiah'),
  ('THB', 2, 'Thai baht'), ('TRY', 2, 'Turkish lira'), ('EGP', 2, 'Egyptian pound'), ('NGN', 2, 'Nigerian naira'),
  ('KES', 2, 'Kenyan shilling'), ('ZAR', 2, 'South African rand'), ('CAD', 2, 'Canadian dollar'),
  ('AUD', 2, 'Australian dollar'), ('NZD', 2, 'New Zealand dollar'), ('CHF', 2, 'Swiss franc'),
  ('SEK', 2, 'Swedish krona'), ('NOK', 2, 'Norwegian krone'), ('DKK', 2, 'Danish krone'), ('PLN', 2, 'Polish zloty'),
  ('BRL', 2, 'Brazilian real'), ('MXN', 2, 'Mexican peso');

-- BUKU's own kinds of business (D-100): 11 groups, then their kinds; IDs fixed so every
-- environment has the same ones. Owners' suggestions (D-098) get snowflake IDs later.
INSERT INTO "reference"."categories" ("id", "parent_id", "depth", "sort_order", "is_active", "pending", "slug", "name", "name_key") VALUES
  (1, NULL, 0, 0, true, false, 'beauty-hair', 'Beauty & Hair', 'beautyandhair'),
  (2, NULL, 0, 1, true, false, 'health-medical', 'Health & Medical', 'healthandmedical'),
  (3, NULL, 0, 2, true, false, 'wellness-spa', 'Wellness & Spa', 'wellnessandspa'),
  (4, NULL, 0, 3, true, false, 'fitness', 'Fitness', 'fitnes'),
  (5, NULL, 0, 4, true, false, 'automotive', 'Automotive', 'automotive'),
  (6, NULL, 0, 5, true, false, 'pets', 'Pets', 'pet'),
  (7, NULL, 0, 6, true, false, 'government-public', 'Government & Public', 'governmentandpublic'),
  (8, NULL, 0, 7, true, false, 'home-professional', 'Home & Professional', 'homeandprofessional'),
  (9, NULL, 0, 8, true, false, 'education-tutoring', 'Education & Tutoring', 'educationandtutoring'),
  (10, NULL, 0, 9, true, false, 'events-photography', 'Events & Photography', 'eventsandphotography'),
  (11, NULL, 0, 10, true, false, 'finance-banking', 'Finance & Banking', 'financeandbanking'),
  (12, 1, 1, 0, true, false, 'barbershop', 'Barbershop', 'barbershop'),
  (13, 1, 1, 1, true, false, 'hair-salon', 'Hair Salon', 'hairsalon'),
  (14, 1, 1, 2, true, false, 'nail-salon', 'Nail Salon', 'nailsalon'),
  (15, 1, 1, 3, true, false, 'beauty-parlour', 'Beauty Parlour', 'beautyparlour'),
  (16, 1, 1, 4, true, false, 'bridal-makeup', 'Bridal Makeup', 'bridalmakeup'),
  (17, 1, 1, 5, true, false, 'makeup-artist', 'Makeup Artist', 'makeupartist'),
  (18, 1, 1, 6, true, false, 'lash-and-brow-studio', 'Lash & Brow Studio', 'lashandbrowstudio'),
  (19, 1, 1, 7, true, false, 'waxing-and-threading', 'Waxing & Threading', 'waxingandthreading'),
  (20, 1, 1, 8, true, false, 'facial-and-skin-care', 'Facial & Skin Care', 'facialandskincare'),
  (21, 1, 1, 9, true, false, 'henna-artist', 'Henna Artist', 'hennaartist'),
  (22, 1, 1, 10, true, false, 'tattoo-studio', 'Tattoo Studio', 'tattoostudio'),
  (23, 2, 1, 0, true, false, 'dental-clinic', 'Dental Clinic', 'dentalclinic'),
  (24, 2, 1, 1, true, false, 'general-physician', 'General Physician', 'generalphysician'),
  (25, 2, 1, 2, true, false, 'physiotherapy', 'Physiotherapy', 'physiotherapy'),
  (26, 2, 1, 3, true, false, 'hospital-opd', 'Hospital OPD', 'hospitalopd'),
  (27, 2, 1, 4, true, false, 'dermatologist', 'Dermatologist', 'dermatologist'),
  (28, 2, 1, 5, true, false, 'aesthetic-and-laser-clinic', 'Aesthetic & Laser Clinic', 'aestheticandlaserclinic'),
  (29, 2, 1, 6, true, false, 'eye-clinic', 'Eye Clinic', 'eyeclinic'),
  (30, 2, 1, 7, true, false, 'optician', 'Optician', 'optician'),
  (31, 2, 1, 8, true, false, 'child-specialist', 'Child Specialist', 'childspecialist'),
  (32, 2, 1, 9, true, false, 'gynaecologist', 'Gynaecologist', 'gynaecologist'),
  (33, 2, 1, 10, true, false, 'fertility-clinic', 'Fertility Clinic', 'fertilityclinic'),
  (34, 2, 1, 11, true, false, 'cardiologist', 'Cardiologist', 'cardiologist'),
  (35, 2, 1, 12, true, false, 'orthopaedic-specialist', 'Orthopaedic Specialist', 'orthopaedicspecialist'),
  (36, 2, 1, 13, true, false, 'ent-specialist', 'ENT Specialist', 'entspecialist'),
  (37, 2, 1, 14, true, false, 'psychologist', 'Psychologist', 'psychologist'),
  (38, 2, 1, 15, true, false, 'psychiatrist', 'Psychiatrist', 'psychiatrist'),
  (39, 2, 1, 16, true, false, 'speech-therapy', 'Speech Therapy', 'speechtherapy'),
  (40, 2, 1, 17, true, false, 'nutritionist', 'Nutritionist', 'nutritionist'),
  (41, 2, 1, 18, true, false, 'diagnostic-lab', 'Diagnostic Lab', 'diagnosticlab'),
  (42, 2, 1, 19, true, false, 'radiology-and-imaging', 'Radiology & Imaging', 'radiologyandimaging'),
  (43, 2, 1, 20, true, false, 'chiropractor', 'Chiropractor', 'chiropractor'),
  (44, 2, 1, 21, true, false, 'hearing-clinic', 'Hearing Clinic', 'hearingclinic'),
  (45, 2, 1, 22, true, false, 'vaccination-centre', 'Vaccination Centre', 'vaccinationcentre'),
  (46, 2, 1, 23, true, false, 'homeopathic-clinic', 'Homeopathic Clinic', 'homeopathicclinic'),
  (47, 3, 1, 0, true, false, 'spa', 'Spa', 'spa'),
  (48, 3, 1, 1, true, false, 'massage', 'Massage', 'massage'),
  (49, 3, 1, 2, true, false, 'yoga-studio', 'Yoga Studio', 'yogastudio'),
  (50, 3, 1, 3, true, false, 'hijama-and-cupping', 'Hijama & Cupping', 'hijamaandcupping'),
  (51, 3, 1, 4, true, false, 'meditation-centre', 'Meditation Centre', 'meditationcentre'),
  (52, 3, 1, 5, true, false, 'sauna-and-steam-bath', 'Sauna & Steam Bath', 'saunaandsteambath'),
  (53, 3, 1, 6, true, false, 'acupuncture', 'Acupuncture', 'acupuncture'),
  (54, 3, 1, 7, true, false, 'reflexology', 'Reflexology', 'reflexology'),
  (55, 4, 1, 0, true, false, 'gym', 'Gym', 'gym'),
  (56, 4, 1, 1, true, false, 'personal-training', 'Personal Training', 'personaltraining'),
  (57, 4, 1, 2, true, false, 'pilates-studio', 'Pilates Studio', 'pilatesstudio'),
  (58, 4, 1, 3, true, false, 'martial-arts', 'Martial Arts', 'martialart'),
  (59, 4, 1, 4, true, false, 'boxing-gym', 'Boxing Gym', 'boxinggym'),
  (60, 4, 1, 5, true, false, 'dance-studio', 'Dance Studio', 'dancestudio'),
  (61, 4, 1, 6, true, false, 'swimming-lessons', 'Swimming Lessons', 'swimminglesson'),
  (62, 4, 1, 7, true, false, 'padel-court', 'Padel Court', 'padelcourt'),
  (63, 4, 1, 8, true, false, 'futsal-ground', 'Futsal Ground', 'futsalground'),
  (64, 4, 1, 9, true, false, 'cricket-nets', 'Cricket Nets', 'cricketnet'),
  (65, 4, 1, 10, true, false, 'squash-court', 'Squash Court', 'squashcourt'),
  (66, 4, 1, 11, true, false, 'tennis-court', 'Tennis Court', 'tenniscourt'),
  (67, 5, 1, 0, true, false, 'car-wash', 'Car Wash', 'carwash'),
  (68, 5, 1, 1, true, false, 'auto-repair', 'Auto Repair', 'autorepair'),
  (69, 5, 1, 2, true, false, 'car-detailing', 'Car Detailing', 'cardetailing'),
  (70, 5, 1, 3, true, false, 'oil-change', 'Oil Change', 'oilchange'),
  (71, 5, 1, 4, true, false, 'tyres-and-alignment', 'Tyres & Alignment', 'tyresandalignment'),
  (72, 5, 1, 5, true, false, 'car-ac-repair', 'Car AC Repair', 'caracrepair'),
  (73, 5, 1, 6, true, false, 'body-and-paint-shop', 'Body & Paint Shop', 'bodyandpaintshop'),
  (74, 5, 1, 7, true, false, 'vehicle-inspection', 'Vehicle Inspection', 'vehicleinspection'),
  (75, 5, 1, 8, true, false, 'motorbike-repair', 'Motorbike Repair', 'motorbikerepair'),
  (76, 5, 1, 9, true, false, 'driving-school', 'Driving School', 'drivingschool'),
  (77, 6, 1, 0, true, false, 'pet-grooming', 'Pet Grooming', 'petgrooming'),
  (78, 6, 1, 1, true, false, 'veterinary', 'Veterinary', 'veterinary'),
  (79, 6, 1, 2, true, false, 'pet-boarding', 'Pet Boarding', 'petboarding'),
  (80, 6, 1, 3, true, false, 'pet-daycare', 'Pet Daycare', 'petdaycare'),
  (81, 6, 1, 4, true, false, 'dog-training', 'Dog Training', 'dogtraining'),
  (82, 7, 1, 0, true, false, 'passport-office', 'Passport Office', 'passportoffice'),
  (83, 7, 1, 1, true, false, 'utility-services', 'Utility Services', 'utilityservice'),
  (84, 7, 1, 2, true, false, 'id-card-office', 'ID Card Office', 'idcardoffice'),
  (85, 7, 1, 3, true, false, 'driving-licence-office', 'Driving Licence Office', 'drivinglicenceoffice'),
  (86, 7, 1, 4, true, false, 'excise-and-taxation-office', 'Excise & Taxation Office', 'exciseandtaxationoffice'),
  (87, 7, 1, 5, true, false, 'police-verification', 'Police Verification', 'policeverification'),
  (88, 7, 1, 6, true, false, 'post-office', 'Post Office', 'postoffice'),
  (89, 7, 1, 7, true, false, 'visa-application-centre', 'Visa Application Centre', 'visaapplicationcentre'),
  (90, 7, 1, 8, true, false, 'union-council-office', 'Union Council Office', 'unioncounciloffice'),
  (91, 7, 1, 9, true, false, 'land-records-office', 'Land Records Office', 'landrecordsoffice'),
  (92, 8, 1, 0, true, false, 'tailor', 'Tailor', 'tailor'),
  (93, 8, 1, 1, true, false, 'legal-consultation', 'Legal Consultation', 'legalconsultation'),
  (94, 8, 1, 2, true, false, 'accountant-and-tax-advisor', 'Accountant & Tax Advisor', 'accountantandtaxadvisor'),
  (95, 8, 1, 3, true, false, 'notary-public', 'Notary Public', 'notarypublic'),
  (96, 8, 1, 4, true, false, 'immigration-consultant', 'Immigration Consultant', 'immigrationconsultant'),
  (97, 8, 1, 5, true, false, 'real-estate-agent', 'Real Estate Agent', 'realestateagent'),
  (98, 8, 1, 6, true, false, 'architect', 'Architect', 'architect'),
  (99, 8, 1, 7, true, false, 'interior-designer', 'Interior Designer', 'interiordesigner'),
  (100, 8, 1, 8, true, false, 'phone-and-computer-repair', 'Phone & Computer Repair', 'phoneandcomputerrepair'),
  (101, 8, 1, 9, true, false, 'mobile-network-service-centre', 'Mobile Network Service Centre', 'mobilenetworkservicecentre'),
  (102, 8, 1, 10, true, false, 'appliance-repair', 'Appliance Repair', 'appliancerepair'),
  (103, 8, 1, 11, true, false, 'ac-service', 'AC Service', 'acservice'),
  (104, 8, 1, 12, true, false, 'plumber', 'Plumber', 'plumber'),
  (105, 8, 1, 13, true, false, 'electrician', 'Electrician', 'electrician'),
  (106, 8, 1, 14, true, false, 'carpenter', 'Carpenter', 'carpenter'),
  (107, 8, 1, 15, true, false, 'home-cleaning', 'Home Cleaning', 'homecleaning'),
  (108, 8, 1, 16, true, false, 'pest-control', 'Pest Control', 'pestcontrol'),
  (109, 8, 1, 17, true, false, 'laundry-and-dry-cleaning', 'Laundry & Dry Cleaning', 'laundryanddrycleaning'),
  (110, 8, 1, 18, true, false, 'printing-and-copy-shop', 'Printing & Copy Shop', 'printingandcopyshop'),
  (111, 9, 1, 0, true, false, 'tutoring-centre', 'Tutoring Centre', 'tutoringcentre'),
  (112, 9, 1, 1, true, false, 'home-tutor', 'Home Tutor', 'hometutor'),
  (113, 9, 1, 2, true, false, 'test-preparation', 'Test Preparation', 'testpreparation'),
  (114, 9, 1, 3, true, false, 'language-school', 'Language School', 'languageschool'),
  (115, 9, 1, 4, true, false, 'quran-classes', 'Quran Classes', 'quranclasse'),
  (116, 9, 1, 5, true, false, 'computer-training', 'Computer Training', 'computertraining'),
  (117, 9, 1, 6, true, false, 'music-lessons', 'Music Lessons', 'musiclesson'),
  (118, 9, 1, 7, true, false, 'art-classes', 'Art Classes', 'artclasse'),
  (119, 10, 1, 0, true, false, 'photography-studio', 'Photography Studio', 'photographystudio'),
  (120, 10, 1, 1, true, false, 'wedding-photographer', 'Wedding Photographer', 'weddingphotographer'),
  (121, 10, 1, 2, true, false, 'videographer', 'Videographer', 'videographer'),
  (122, 10, 1, 3, true, false, 'event-planner', 'Event Planner', 'eventplanner'),
  (123, 10, 1, 4, true, false, 'wedding-hall-and-marquee', 'Wedding Hall & Marquee', 'weddinghallandmarquee'),
  (124, 11, 1, 0, true, false, 'bank-branch', 'Bank Branch', 'bankbranch'),
  (125, 11, 1, 1, true, false, 'currency-exchange', 'Currency Exchange', 'currencyexchange'),
  (126, 11, 1, 2, true, false, 'insurance-office', 'Insurance Office', 'insuranceoffice'),
  (127, 11, 1, 3, true, false, 'financial-advisor', 'Financial Advisor', 'financialadvisor');

-- Plans as v1 left them (D-065, D-101): data admins edit at any time.
INSERT INTO "reference"."plans" ("id", "sort_order", "is_public", "code", "audience", "name", "tagline", "benefits", "limits", "features") VALUES
  (1, 0, false, 'business_free', 'business', 'Starter', 'Get listed and take bookings', '["Online bookings and receipts", "1 team login", "Up to 2 bookable staff"]', '{"photos": 5, "services": 10, "team_accounts": 1, "staff_profiles": 2}', '{"ads": false, "queue": false, "staff_photos": false, "manual_approval": false, "priority_support": false}'),
  (2, 1, true, 'business_essential', 'business', 'Essential', 'For barbers, clinics and local shops', '["Online bookings and receipts", "Virtual queue with live display", "Up to 3 team logins and 5 bookable staff", "Staff photos", "Approve bookings by hand"]', '{"photos": 10, "services": 30, "team_accounts": 3, "staff_profiles": 5}', '{"ads": false, "queue": true, "staff_photos": true, "manual_approval": true, "priority_support": false}'),
  (3, 2, true, 'business_professional', 'business', 'Professional', 'For growing teams and multi-chair practices', '["Everything in Essential", "Up to 15 team logins and 25 bookable staff", "100 services, 30 photos", "Priority support"]', '{"photos": 30, "services": 100, "team_accounts": 15, "staff_profiles": 25}', '{"ads": false, "queue": true, "staff_photos": true, "manual_approval": true, "priority_support": true}'),
  (4, 3, true, 'business_enterprise', 'business', 'Enterprise', 'For large organisations', '["Everything in Professional", "Unlimited team logins and staff", "Unlimited services and photos", "Priority support"]', '{"photos": null, "services": null, "team_accounts": null, "staff_profiles": null}', '{"ads": true, "queue": true, "staff_photos": true, "manual_approval": true, "priority_support": true}'),
  (5, 99, false, 'business_unlimited', 'business', 'Unlimited (billing off)', NULL, '[]', '{}', '{"ads": true, "queue": true, "staff_photos": true, "manual_approval": true, "priority_support": false}'),
  (6, 0, true, 'user_free', 'user', 'Free', 'Try BUKU', '["1 free booking or queue join", "Browse and search every business", "Booking receipts and queue tickets"]', '{"visits": 1}', '{}'),
  (7, 1, true, 'user_plus', 'user', 'BUKU Plus', 'Book and queue without limits', '["Unlimited bookings", "Unlimited queue joins", "Live queue position and alerts", "Reminders before every appointment"]', '{"visits": null}', '{}'),
  (8, 99, false, 'user_unlimited', 'user', 'Unlimited (billing off)', NULL, '[]', '{}', '{}');

-- Their prices, in minor units (DB-009): 199 = USD 1.99.
INSERT INTO "reference"."plan_prices" ("id", "plan_id", "amount_minor", "trial_days", "tax_inclusive", "channel", "currency", "interval") VALUES
  (1, 2, 2499, 0, false, 'web', 'USD', 'month'),
  (2, 3, 4999, 0, false, 'web', 'USD', 'month'),
  (3, 4, 9999, 0, false, 'web', 'USD', 'month'),
  (4, 7, 199, 0, false, 'web', 'USD', 'month'),
  (5, 7, 199, 0, false, 'android', 'USD', 'month'),
  (6, 7, 499, 0, false, 'ios', 'USD', 'month');

-- Charging is off for both (customers are free, D-101; businesses until launch).
INSERT INTO "reference"."billing_settings" ("audience", "default_plan_id", "plan_when_disabled_id", "trial_plan_id", "trial_days", "enabled", "trial_enabled") VALUES
  ('business', 1, 5, 3, 30, false, true),
  ('user', 6, 8, 7, 30, false, false);

INSERT INTO "reference"."billing_channel_fees" ("channel", "fixed_minor", "percent", "currency", "notes") VALUES
  ('android', 0, 15.0, 'USD', 'Google Play subscriptions'),
  ('ios', 0, 15.0, 'USD', 'App Store Small Business Program (30% above $1M/year)'),
  ('web', 50, 5.0, 'USD', 'Paddle (merchant of record: collects and remits sales tax/VAT)');

INSERT INTO "reference"."billing_cost_items" ("id", "monthly_minor", "category", "currency", "name", "notes") VALUES
  (1, 1000, 'infrastructure', 'USD', 'Backups and monitoring', 'Estimate - replace with your invoice'),
  (2, 4800, 'infrastructure', 'USD', 'DigitalOcean Droplet (app server)', 'Estimate - replace with your invoice'),
  (3, 3000, 'infrastructure', 'USD', 'DigitalOcean Managed PostgreSQL', 'Estimate - replace with your invoice'),
  (4, 1500, 'infrastructure', 'USD', 'DigitalOcean Managed Valkey', 'Estimate - replace with your invoice'),
  (5, 500, 'infrastructure', 'USD', 'DigitalOcean Spaces + CDN', 'Estimate - replace with your invoice');
INSERT INTO "reference"."notification_settings" ("id") VALUES (1);

-- ═══════════════════════ Published, read-only elsewhere ═══════════════════════
-- Every reference table is in the publication: a new one is added here in its own migration
-- (ALTER PUBLICATION … ADD TABLE; a test checks), and provisioning refreshes every copy.
CREATE PUBLICATION "buku_reference" FOR TABLE "reference"."currencies", "reference"."categories",
  "reference"."plans", "reference"."plan_prices", "reference"."billing_settings", "reference"."billing_channel_fees",
  "reference"."billing_cost_items", "reference"."notification_settings";

-- Read by tools, tests and the replicator (which copies it); written per service (D2d).
REVOKE ALL ON ALL TABLES IN SCHEMA "reference" FROM PUBLIC, buku_app;
GRANT USAGE ON SCHEMA "reference" TO buku_app, buku_replicator;
GRANT SELECT ON ALL TABLES IN SCHEMA "reference" TO buku_app, buku_replicator;
