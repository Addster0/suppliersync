alter table public.vendor_evaluations add column if not exists criteria jsonb not null default '{}'::jsonb;

alter table public.vendor_evaluations add column if not exists recommendation text not null default 'acceptable';

alter table public.vendor_evaluations add column if not exists reviewer_name text not null default '';

alter table public.vendor_evaluations drop constraint if exists vendor_evaluations_score_check;

update public.vendor_evaluations set score = greatest(1, least(5, round(score / 2.0)::smallint)) where criteria = '{}'::jsonb;

alter table public.vendor_evaluations add constraint vendor_evaluations_score_check check (score between 1 and 5);

alter table public.vendor_evaluations drop constraint if exists vendor_evaluations_recommendation_check;

alter table public.vendor_evaluations add constraint vendor_evaluations_recommendation_check check (recommendation in ('preferred', 'acceptable', 'under_review', 'do_not_renew'));
