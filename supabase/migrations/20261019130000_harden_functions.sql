-- Fixes from the Supabase security advisor.

-- 1. owns_sandbox() was callable through the API (/rest/v1/rpc/owns_sandbox).
--    Move it to a schema the API does not expose; RLS policies can still call it.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create function private.owns_sandbox(sid uuid)
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
revoke all on function private.owns_sandbox(uuid) from public, anon;
grant execute on function private.owns_sandbox(uuid) to authenticated, service_role;

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
    execute format('drop policy "sandbox owner can read" on public.%I', t);
    execute format(
      'create policy "sandbox owner can read" on public.%I for select to authenticated using (private.owns_sandbox(sandbox_id))',
      t
    );
  end loop;
end $$;

drop function public.owns_sandbox(uuid);

-- 2. The project's automatic-RLS helper should not be callable by API users.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- Indexes for foreign keys reported as unindexed.
create index on public.applications (pass_id);
create index on public.chat_messages (sender_profile_id);
create index on public.dining_tables (match_run_id);
create index on public.dining_tables (venue_id);
create index on public.exception_cases (event_slot_id);
create index on public.exception_cases (table_id);
create index on public.feedback_people (target_profile_id);
create index on public.feedback_people (feedback_id);
create index on public.feedbacks (table_id);
create index on public.match_resolutions (application_id);
create index on public.match_runs (event_slot_id);
create index on public.payments (application_id);
create index on public.payments (pass_id);
create index on public.profiles (source_profile_id);
create index on public.table_members (application_id);
