-- Profiles the demo visitor can view as: themselves and the participant set up to fail.
alter table public.sandboxes add column me_profile_id uuid references public.profiles (id) on delete set null;
alter table public.sandboxes add column fail_profile_id uuid references public.profiles (id) on delete set null;
-- Consent is required before applying (PRD ACC-05).
alter table public.profiles add column consented_at timestamptz;
