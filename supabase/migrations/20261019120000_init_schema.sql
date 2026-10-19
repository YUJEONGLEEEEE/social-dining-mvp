-- Initial schema for Wooyeon Table.
-- Security model:
--   * Every business table is scoped by sandbox_id (one sandbox per demo visitor).
--   * RLS is on everywhere and denies by default.
--   * The anon role gets no privileges at all.
--   * Signed-in users may only SELECT rows of sandboxes they own.
--   * All writes go through server code using the secret key (service_role).

-- ---------------------------------------------------------------------------
-- Sandboxes
-- ---------------------------------------------------------------------------
create table public.sandboxes (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'demo' check (kind in ('base', 'demo')),
  owner_user_id uuid references auth.users (id) on delete cascade,
  demo_clock timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'base') = (owner_user_id is null))
);
create index on public.sandboxes (owner_user_id);

-- True when the signed-in user owns the given sandbox.
create function public.owns_sandbox(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sandboxes s
    where s.id = sid and s.owner_user_id = (select auth.uid())
  );
$$;
revoke all on function public.owns_sandbox(uuid) from public, anon;
grant execute on function public.owns_sandbox(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- People and passes
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  source_profile_id uuid references public.profiles (id) on delete set null,
  display_name text not null,
  birth_year int check (birth_year between 1940 and 2010),
  gender text not null check (gender in ('female', 'male')),
  mbti text check (mbti ~ '^[EI][NS][TF][JP]$'),
  mbti_raw text,
  job text,
  interests text[] not null default '{}',
  personality text[] not null default '{}',
  wants text[] not null default '{}',
  budget text check (budget in ('10k_20k', '20k_30k', '30k_plus')),
  food_restrictions text,
  region_raw text,
  is_virtual boolean not null default true,
  no_show_count int not null default 0,
  restricted_until timestamptz,
  created_at timestamptz not null default now()
);
create index on public.profiles (sandbox_id);
create index on public.profiles (user_id);

create table public.passes (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('single', 'membership_1m', 'membership_3m', 'membership_6m')),
  price int not null check (price >= 0),
  remaining_count int check (remaining_count >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  extended_days int not null default 0,
  created_at timestamptz not null default now(),
  check ((kind = 'single') = (remaining_count is not null))
);
create index on public.passes (sandbox_id);
create index on public.passes (profile_id);

-- ---------------------------------------------------------------------------
-- Venues and event slots
-- ---------------------------------------------------------------------------
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  name text not null,
  region text not null check (region in ('hongdae', 'jamsil', 'gangnam', 'euljiro')),
  address text,
  price_band text check (price_band in ('10k_20k', '20k_30k', '30k_plus')),
  rating numeric(2, 1) check (rating between 0 and 5),
  tables_available int not null default 0 check (tables_available >= 0),
  created_at timestamptz not null default now()
);
create index on public.venues (sandbox_id);

create table public.event_slots (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  event_date date not null,
  region text not null check (region in ('hongdae', 'jamsil', 'gangnam', 'euljiro')),
  starts_at timestamptz not null,
  match_deadline_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'matching', 'confirmed', 'done', 'cancelled')),
  is_history boolean not null default false,
  created_at timestamptz not null default now(),
  unique (sandbox_id, event_date, region)
);
create index on public.event_slots (sandbox_id);

-- ---------------------------------------------------------------------------
-- Applications (four separate statuses, PRD ch. 12) and payments
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  pass_id uuid references public.passes (id) on delete set null,
  week_of date not null,
  application_status text not null default 'submitted'
    check (application_status in ('draft', 'submitted', 'cancelled', 'moved')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'refund_requested', 'refunded', 'pass_kept', 'failed')),
  match_status text not null default 'waiting'
    check (match_status in ('waiting', 'matching', 'reassigning', 'confirmed', 'failed', 'resolved')),
  attendance_status text not null default 'none'
    check (attendance_status in ('none', 'confirmed', 'checked_in', 'no_show', 'same_day_cancelled')),
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.applications (sandbox_id);
create index on public.applications (profile_id);

create table public.application_options (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  event_slot_id uuid not null references public.event_slots (id) on delete cascade,
  priority int not null default 1,
  note text,
  unique (application_id, event_slot_id)
);
create index on public.application_options (sandbox_id);
create index on public.application_options (event_slot_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  pass_id uuid references public.passes (id) on delete set null,
  kind text not null check (kind in ('pay', 'refund')),
  amount int not null check (amount >= 0),
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed')),
  is_mock boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.payments (sandbox_id);

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------
create table public.matching_rules (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null unique references public.sandboxes (id) on delete cascade,
  weight_gender numeric not null default 30,
  weight_mbti numeric not null default 20,
  weight_interests numeric not null default 20,
  weight_wants numeric not null default 15,
  weight_new_people numeric not null default 15,
  min_score numeric not null default 60,
  max_age_gap int not null default 8,
  updated_at timestamptz not null default now()
);

create table public.match_runs (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  event_slot_id uuid references public.event_slots (id) on delete set null,
  idempotency_key text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  rules_snapshot jsonb not null default '{}',
  summary jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (sandbox_id, idempotency_key)
);
create index on public.match_runs (sandbox_id);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  match_run_id uuid references public.match_runs (id) on delete set null,
  event_slot_id uuid not null references public.event_slots (id) on delete cascade,
  venue_id uuid references public.venues (id) on delete set null,
  status text not null default 'forming' check (status in ('forming', 'confirmed', 'dissolved', 'done')),
  score numeric,
  reason text,
  created_at timestamptz not null default now()
);
create index on public.dining_tables (sandbox_id);
create index on public.dining_tables (event_slot_id);

create table public.table_members (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  table_id uuid not null references public.dining_tables (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_reason text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason text
);
create index on public.table_members (sandbox_id);
create index on public.table_members (table_id);
create index on public.table_members (profile_id);

create table public.match_resolutions (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  kind text not null
    check (kind in ('moved_slot', 'kept_pass', 'refunded', 'membership_extended', 'waitlist_filled')),
  reason text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.match_resolutions (sandbox_id);

-- ---------------------------------------------------------------------------
-- Messages, conversation cards, notifications
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  table_id uuid not null references public.dining_tables (id) on delete cascade,
  sender_profile_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('system', 'topic_card', 'user')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on public.chat_messages (sandbox_id);
create index on public.chat_messages (table_id, created_at);

create table public.conversation_cards (
  id uuid primary key default gen_random_uuid(),
  stage text not null check (stage in ('opening', 'middle', 'closing')),
  body text not null,
  tags text[] not null default '{}'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  delivery_status text not null default 'sent' check (delivery_status in ('queued', 'sent', 'failed')),
  retry_count int not null default 0,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (sandbox_id);
create index on public.notifications (profile_id, created_at);

-- ---------------------------------------------------------------------------
-- Feedback and relations between people
-- ---------------------------------------------------------------------------
create table public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  application_id uuid not null unique references public.applications (id) on delete cascade,
  table_id uuid references public.dining_tables (id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.feedbacks (sandbox_id);

create table public.feedback_people (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  feedback_id uuid not null references public.feedbacks (id) on delete cascade,
  target_profile_id uuid not null references public.profiles (id) on delete cascade,
  choice text not null check (choice in ('again', 'neutral', 'never')),
  unique (feedback_id, target_profile_id)
);
create index on public.feedback_people (sandbox_id);

create table public.user_relations (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  other_profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('met', 'mutual_again', 'blocked', 'disliked')),
  source text,
  created_at timestamptz not null default now(),
  check (profile_id <> other_profile_id),
  unique (profile_id, other_profile_id, kind)
);
create index on public.user_relations (sandbox_id);
create index on public.user_relations (other_profile_id);

-- ---------------------------------------------------------------------------
-- Operations: exception queue and audit log
-- ---------------------------------------------------------------------------
create table public.exception_cases (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  type text not null
    check (type in ('venue_shortage', 'table_underfilled', 'safety_report', 'payment_failed', 'notification_failed', 'other')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  title text not null,
  detail jsonb not null default '{}',
  event_slot_id uuid references public.event_slots (id) on delete set null,
  table_id uuid references public.dining_tables (id) on delete set null,
  retry_count int not null default 0,
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.exception_cases (sandbox_id, status);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  entity text not null,
  entity_id uuid,
  actor text not null,
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (sandbox_id, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  sandboxed text[] := array[
    'profiles', 'passes', 'venues', 'event_slots', 'applications', 'application_options',
    'payments', 'matching_rules', 'match_runs', 'dining_tables', 'table_members',
    'match_resolutions', 'chat_messages', 'notifications', 'feedbacks', 'feedback_people',
    'user_relations', 'exception_cases', 'audit_logs'
  ];
begin
  foreach t in array sandboxed loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy "sandbox owner can read" on public.%I for select to authenticated using (public.owns_sandbox(sandbox_id))',
      t
    );
  end loop;
end $$;

alter table public.sandboxes enable row level security;
revoke all on public.sandboxes from anon, authenticated;
grant select on public.sandboxes to authenticated;
grant all on public.sandboxes to service_role;
create policy "owner can read own sandbox" on public.sandboxes
  for select to authenticated using (owner_user_id = (select auth.uid()));

-- Conversation cards are shared, non-personal content.
alter table public.conversation_cards enable row level security;
revoke all on public.conversation_cards from anon, authenticated;
grant select on public.conversation_cards to authenticated;
grant all on public.conversation_cards to service_role;
create policy "signed-in users can read cards" on public.conversation_cards
  for select to authenticated using (true);

grant usage on sequence public.audit_logs_id_seq to service_role;
