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
select id, source_url, register_published_at, status,
       rows_downloaded, rows_parsed, rows_inserted, rows_updated,
       rows_unchanged, rows_rejected, rows_withdrawn,
       started_at, finished_at
from public.sponsor_register_imports
where status = 'success'
order by started_at desc
limit 1;

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
