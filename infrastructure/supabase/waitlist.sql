-- Early access (D-134): people and businesses who want BUKU when it opens.
--
-- Run once in the Supabase project's SQL editor (it is safe to run again). The table is closed
-- to everyone: row-level security is on and has no policies, and the browser roles (anon,
-- authenticated) have no rights on it. The website's server reaches it with the project's
-- secret key, through join_waitlist only, which checks every field again (the website checks
-- them first), keeps one row per email and kind, and slows down repeats from one address.
-- No raw IP address is stored: only a keyed hash (ip_hash), so repeats can be counted.

create table if not exists public.waitlist (
  id            bigint generated always as identity primary key,
  email         text        not null,
  kind          text        not null,
  name          text,
  business_name text,
  business_type text,
  branches      text,
  city          text        not null,
  country       char(2)     not null,
  whatsapp      text,
  plan_interest text,
  source        text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  ip_hash       text,
  consent_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  constraint waitlist_one_per_email unique (email, kind),
  constraint waitlist_email check (char_length(email) between 3 and 254 and email = lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint waitlist_kind check (kind in ('business', 'customer')),
  constraint waitlist_name check (name is null or char_length(name) between 1 and 120),
  constraint waitlist_business_name check (business_name is null or char_length(business_name) between 2 and 160),
  constraint waitlist_business_type check (business_type is null or char_length(business_type) between 2 and 80),
  constraint waitlist_branches check (branches is null or branches in ('1', '2-5', '6-20', '21+')),
  constraint waitlist_city check (char_length(city) between 2 and 80),
  constraint waitlist_country check (country ~ '^[A-Z]{2}$'),
  constraint waitlist_whatsapp check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  constraint waitlist_plan check (plan_interest is null
    or plan_interest in ('starter', 'essential', 'professional', 'network', 'enterprise', 'not_sure')),
  constraint waitlist_tags check (
    coalesce(char_length(source), 0) <= 80 and coalesce(char_length(utm_source), 0) <= 80
    and coalesce(char_length(utm_medium), 0) <= 80 and coalesce(char_length(utm_campaign), 0) <= 80),
  constraint waitlist_ip_hash check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- A business tells us who it is; a customer only needs an email and a city.
  constraint waitlist_business_details check (kind = 'customer'
    or (name is not null and business_name is not null and business_type is not null
        and branches is not null and plan_interest is not null))
);

create index if not exists waitlist_ip_recent on public.waitlist (ip_hash, created_at) where ip_hash is not null;
create index if not exists waitlist_created on public.waitlist (created_at);

-- Supabase grants this already; said here so the script stands on its own.
grant usage on schema public to service_role;

alter table public.waitlist enable row level security;
revoke all on table public.waitlist from public, anon, authenticated;

create or replace function public.join_waitlist(
  p_email         text,
  p_kind          text,
  p_city          text,
  p_country       text,
  p_name          text default null,
  p_business_name text default null,
  p_business_type text default null,
  p_branches      text default null,
  p_whatsapp      text default null,
  p_plan_interest text default null,
  p_source        text default null,
  p_utm_source    text default null,
  p_utm_medium    text default null,
  p_utm_campaign  text default null,
  p_ip_hash       text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  -- At most five signups an hour from one address: enough for a family or an office, not a script.
  if p_ip_hash is not null then
    select count(*) into recent
      from public.waitlist
     where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
    if recent >= 5 then
      return 'slow_down';
    end if;
  end if;

  insert into public.waitlist (email, kind, name, business_name, business_type, branches, city, country,
                               whatsapp, plan_interest, source, utm_source, utm_medium, utm_campaign, ip_hash)
  values (lower(trim(p_email)), p_kind, p_name, p_business_name, p_business_type, p_branches, p_city, upper(p_country),
          p_whatsapp, p_plan_interest, p_source, p_utm_source, p_utm_medium, p_utm_campaign, p_ip_hash)
  on conflict (email, kind) do nothing;

  if found then
    return 'joined';
  end if;
  return 'already';
end;
$$;

revoke all on function public.join_waitlist(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;
