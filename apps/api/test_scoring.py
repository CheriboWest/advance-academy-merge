"""Self-check for the hiring-signal score: `python test_scoring.py` (no pytest).

Pure-Python: exercises app.crawler.scoring against constructed job groups with
an injected `now`, so it runs offline with no FastAPI/httpx/Supabase deps.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.crawler.models import NormalizedJob
from app.crawler.scoring import (
    active_volume_score,
    breadth_score,
    compute_lead_score,
    momentum_score,
    recency_score,
    recent_activity_score,
    seniority_score,
)

NOW = datetime(2026, 8, 17, 12, 0, 0, tzinfo=timezone.utc)

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


def job(title: str = "Software Engineer", days_ago: float | None = 0) -> NormalizedJob:
    posted = None if days_ago is None else (NOW - timedelta(days=days_ago)).isoformat()
    return NormalizedJob(
        source="adzuna",
        source_job_id="x",
        company_name="Acme",
        title=title,
        city="London",
        posted_at=posted,
    )


def bounded(score: int) -> bool:
    return 0 <= score <= 100


# 1. Company with 0 jobs
check("0 jobs -> 0", compute_lead_score([], now=NOW) == 0)

# 2. Company with 1 active job (fresh)
s1 = compute_lead_score([job(days_ago=1)], now=NOW)
check("1 fresh job -> low & bounded", bounded(s1) and 0 < s1 < 45, f"got {s1}")

# 3. Several active jobs (fresh, varied)
several = [job("Software Engineer", 3), job("Data Analyst", 4),
           job("Sales Manager", 2), job("Marketing Lead", 5)]
s3 = compute_lead_score(several, now=NOW)
check("several fresh jobs -> moderate/strong", bounded(s3) and s3 >= 45, f"got {s3}")

# 4. Many active jobs (fresh)
many = [job(f"Engineer {i}", 3) for i in range(25)]
s4 = compute_lead_score(many, now=NOW)
check("many fresh jobs -> strong", bounded(s4) and s4 >= 60, f"got {s4}")

# 5. Many OLD jobs, none recent
many_old = [job(f"Engineer {i}", 200) for i in range(25)]
s5 = compute_lead_score(many_old, now=NOW)
check("many old jobs -> volume only, no recency/activity", bounded(s5) and s5 <= 40, f"got {s5}")
check("volume(25) == 30", active_volume_score(many_old) == 30)
check("old recent_activity == 0", recent_activity_score(many_old, NOW) == 0)
check("old recency == 0", recency_score(many_old, NOW) == 0)

# 5b. Direct comparison: many-recent should beat many-old (core requirement)
check("many-recent > many-old", s4 > s5, f"{s4} vs {s5}")

# 6. Several newly posted jobs
newish = [job("Engineer", 1), job("Data Scientist", 1), job("Finance Manager", 2)]
check("newly posted -> high recency", recency_score(newish, NOW) == 10)

# 7. Increasing hiring activity (1 in prior 14d -> 8 in last 14d)
increasing = [job(f"Engineer {i}", 3) for i in range(8)] + [job("Old Engineer", 20)]
mo_up = momentum_score(increasing, NOW)
# 8. Decreasing (8 prior -> 1 recent)
decreasing = [job("Engineer", 3)] + [job(f"Old {i}", 20) for i in range(8)]
mo_down = momentum_score(decreasing, NOW)
check("increasing momentum > decreasing", mo_up > mo_down, f"{mo_up} vs {mo_down}")
check("momentum bounded 0..10", 0 <= mo_up <= 10 and 0 <= mo_down <= 10)
check("no recent activity -> 0 momentum", momentum_score([job("E", 200)], NOW) == 0)

# 9. Hiring across many functions
broad = [job("Software Engineer", 3), job("Data Scientist", 3), job("Finance Manager", 3),
         job("Sales Executive", 3), job("Marketing Manager", 3)]
# 10. Hiring only one function (many copies)
narrow = [job("Software Engineer", 3) for _ in range(5)]
check("broad breadth > narrow breadth", breadth_score(broad) > breadth_score(narrow),
      f"{breadth_score(broad)} vs {breadth_score(narrow)}")
check("broad breadth == 15", breadth_score(broad) == 15)
check("narrow breadth == 3 (one function)", breadth_score(narrow) == 3)

# 11. Senior roles present
senior_jobs = [job("Director of Engineering", 3), job("Senior Software Engineer", 3),
               job("Head of Data", 3)]
# 12. No senior roles
junior_jobs = [job("Software Engineer", 3), job("Junior Analyst", 3)]
check("senior > non-senior", seniority_score(senior_jobs) > seniority_score(junior_jobs))
check("no-senior seniority == 0", seniority_score(junior_jobs) == 0)
# false-positive guard: title only, company-name "Chief" not in play; "leader" != "lead"
check("'Team Leader' not counted senior", seniority_score([job("Team Leader", 3)]) == 0)

# 13. Very recent jobs vs 14. Stale jobs (same volume) -> recency distinguishes
fresh_inv = [job(f"Engineer {i}", 1) for i in range(30)]
stale_inv = [job(f"Engineer {i}", 45) for i in range(30)]
check("fresh inventory recency == 10", recency_score(fresh_inv, NOW) == 10)
check("stale inventory recency <= 2", recency_score(stale_inv, NOW) <= 2)
check("fresh total > stale total", compute_lead_score(fresh_inv, now=NOW) > compute_lead_score(stale_inv, now=NOW))

# Bounds: exhaustive-ish
check("empty bounded", bounded(compute_lead_score([], now=NOW)))
check("huge fresh bounded <= 100", compute_lead_score([job(f"Engineer {i}", 0) for i in range(500)], now=NOW) <= 100)
check("null posted_at counts volume, not time",
      active_volume_score([job(days_ago=None)]) == 6 and recency_score([job(days_ago=None)], NOW) == 0)

print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for f in _failures:
        print("  -", f)
    raise SystemExit(1)
print("ALL SCORING TESTS PASSED")
