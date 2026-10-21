-- Feedback in the detail the PRD asks for (FDB-02, FDB-03): mood, conversation and
-- venue scores, plus whether the person would come again and recommend it.
-- Nullable so older rows and the overall rating keep working.
alter table public.feedbacks
  add column rating_mood int check (rating_mood between 1 and 5),
  add column rating_talk int check (rating_talk between 1 and 5),
  add column rating_venue int check (rating_venue between 1 and 5),
  add column would_rejoin text check (would_rejoin in ('yes', 'maybe', 'no')),
  add column would_recommend text check (would_recommend in ('yes', 'maybe', 'no'));
