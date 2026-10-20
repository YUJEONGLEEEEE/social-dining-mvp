-- Where the demo visitor is in the S1 scenario (driven by the demo bar).
alter table public.sandboxes add column demo_stage text not null default 'applied'
  check (demo_stage in ('applied', 'matched', 'reminded', 'dining', 'finished', 'next_matched'));
