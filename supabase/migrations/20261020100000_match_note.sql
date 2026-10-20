-- Why a participant's match failed or moved, shown in the app and the admin.
alter table public.applications add column match_note text;
