-- Automated messages carry a dedupe key so a retried job never sends the same notice twice.
alter table public.notifications add column dedupe_key text;
alter table public.chat_messages add column dedupe_key text;
create unique index notifications_dedupe on public.notifications (sandbox_id, dedupe_key) where dedupe_key is not null;
create unique index chat_messages_dedupe on public.chat_messages (sandbox_id, dedupe_key) where dedupe_key is not null;
