-- CareerHub UK — post-import verification for the sponsor register.
--
-- Run in the Supabase SQL editor after importing an edition. Read-only.
-- The SQL editor runs as a privileged role, so it sees these tables even though
-- anon and authenticated cannot (migration 0008).

\echo '== 1. total licence rows =='
select count(*) as total_licences from public.sponsor_licences;

\echo '== 2. current vs withdrawn =='
select is_current, count(*) as rows
from public.sponsor_licences group by is_current order by is_current desc;

\echo '== 3. latest successful import =='
-- rows_inserted / rows_updated / rows_unchanged are NULL from migration 0009
-- onward. Telling an insert from an update meant downloading the whole table;
-- rows_processed and rows_current_after are counted by the database instead.
select id, source_url, register_published_at, status,
       rows_downloaded, rows_parsed, rows_rejected,
       rows_processed, rows_current_after, rows_withdrawn,
       started_at, finished_at
from public.sponsor_register_imports
where status = 'success'
order by started_at desc
limit 1;

\echo '== 3b. does the published edition match the table? =='
-- rows_processed is what finalization promoted; rows_current_after is what was
-- left current across the whole table. They should agree with each other and
-- with the live count below. A gap means an older edition still holds rows the
-- newest one did not carry, which should be impossible after a success.
with latest as (
  select id, rows_parsed, rows_processed, rows_current_after
  from public.sponsor_register_imports
  where status = 'success'
  order by started_at desc
  limit 1
)
select l.rows_parsed,
       l.rows_processed,
       l.rows_current_after,
       (select count(*) from public.sponsor_licences where is_current)
         as current_now,
       (select count(*) from public.sponsor_licences
         where last_import_id = l.id) as credited_to_this_edition
from latest l;

\echo '== 3c. rows staged by a run that never published (harmless, but visible) =='
-- A failed import leaves its marker on the rows it wrote. They are not current
-- unless a successful edition also carried them; this is what that looks like.
select i.id as staged_by_import, i.status, count(*) as rows,
       count(*) filter (where sl.is_current) as of_which_current
from public.sponsor_licences sl
join public.sponsor_register_imports i on i.id = sl.staged_import_id
where sl.last_import_id is distinct from sl.staged_import_id
group by i.id, i.status
order by rows desc
limit 10;

\echo '== 3d. impossible states (must be 0) =='
-- Staging deliberately omits is_current / withdrawn_at / last_seen_at from the
-- payload so PostgREST leaves them alone (ON CONFLICT DO UPDATE only touches
-- the columns the request carries). If that ever stopped holding, it would show
-- up here as a row that is not current but was never withdrawn — a combination
-- nothing in the importer can produce on purpose. The direction is safe (a
-- licence goes missing rather than being invented) and the next successful
-- import repairs it, but it should never be non-zero.
select count(*) as not_current_but_never_withdrawn
from public.sponsor_licences
where is_current = false
  and withdrawn_at is null
  and last_import_id is not null;

\echo '== 4. all recent import runs (did any fail?) =='
select id, status, rows_parsed, rows_withdrawn, left(coalesce(error,''), 80) as error,
       started_at
from public.sponsor_register_imports
order by started_at desc
limit 10;

\echo '== 5. counts by route =='
select coalesce(route, '(none)') as route, count(*) as rows
from public.sponsor_licences
where is_current
group by route order by rows desc;

\echo '== 6. counts by type and rating =='
select coalesce(type_rating, '(none)') as type_rating,
       licence_type, rating, count(*) as rows
from public.sponsor_licences
where is_current
group by type_rating, licence_type, rating
order by rows desc;

\echo '== 7. rows whose Type & Rating did not parse (should be 0) =='
select count(*) as unparsed_type_rating
from public.sponsor_licences
where is_current and type_rating is not null and licence_type is null;

\echo '== 8. sample records — check the ORIGINAL names survived intact =='
select organisation_name, normalized_name, town_city, county, route,
       licence_type, rating, register_published_at
from public.sponsor_licences
where is_current
order by organisation_name
limit 10;

\echo '== 9. provenance: every row traceable to a file =='
select source_url, register_published_at, count(*) as rows
from public.sponsor_licences
group by source_url, register_published_at
order by rows desc;

\echo '== 10. confirmed company matches =='
select count(*) as confirmed_matches from public.company_sponsorship
where decision = 'match';

\echo '== 11. resolution state across all checked companies =='
select last_decision, count(*) as companies,
       sum(candidate_count) as total_candidates_seen
from public.company_sponsorship_checks
group by last_decision order by companies desc;

\echo '== 12. companies awaiting manual review (retry cap reached) =='
select company_id, attempts, left(coalesce(error,''), 100) as error, checked_at
from public.company_sponsorship_checks
where last_decision = 'error' and attempts >= 9
order by checked_at desc
limit 20;

\echo '== 13. sample confirmed matches, joined to the register =='
select c.name as crawled_company, v.organisation_name as register_name,
       v.town_city, v.route, v.rating, v.confidence, v.matched_on
from public.company_sponsorship_current v
join public.companies c on c.id = v.company_id
order by v.confidence desc
limit 20;

\echo '== 14. companies never checked =='
select count(*) as unchecked_companies
from public.companies c
left join public.company_sponsorship_checks k on k.company_id = c.id
where k.company_id is null;
