# Performance Fix — CV Library Loading (Batched Queries)

**Keyword for interviews:** *N+1 query problem*, fixed by **batched queries** (a.k.a. *batch fetching*).

## What changed

Two endpoints in the CV Library got noticeably faster:

| Endpoint | Before | After |
| --- | --- | --- |
| `GET /api/cv-library/versions/:id/bullets` | ~5.3 s | ~150–300 ms |
| `GET /api/cv-library/versions` | ~1.0 s | ~50–100 ms |

Both fixes live in [backend/src/services/cv-knowledge.service.ts](../backend/src/services/cv-knowledge.service.ts) — `listBulletsWithGaps()` and `listCvVersions()`.

## Why the old approach was slow

The data model is nested:

> A **CV** has many **bullets**. Each bullet has **gaps** (questions for the user). Each gap has **artifacts** (the user's answers/notes).

The old code walked this tree depth-first, asking the database one question at a time:

```
1.  "Give me the bullets in this CV."
2.  For EACH bullet:  "Give me this bullet's text."
3.  For EACH bullet:  "What gaps does this bullet have?"
4.  For EACH gap:     "What artifacts does this gap have?"
```

Each step `await`ed the previous, so the calls happened sequentially over the network. For a CV with 30 bullets and 2 gaps each, that meant **~120 separate round-trips** to Supabase — at ~40 ms each, you land at ~5 seconds. Same shape, smaller scale, on the versions list endpoint (3 round-trips per version).

This is the textbook **N+1 query problem**: one query to get a list, then N more queries (one per row) to get each row's details. It scales linearly with the data and the network round-trip cost dominates everything else.

## How the fix works

Instead of "one question per item," the fix asks **one question per layer**, in batch:

```
1.  "Give me all the bullets in this CV."          (1 query)
2.  "Give me all the gaps for this whole list of bullet IDs."  (1 query)
3.  "Give me all the artifacts for this whole list of gap IDs." (1 query)
4.  Stitch the results together in memory using a hash map keyed by ID.
```

Round-trips drop from ~120 → **4**, and that number stays fixed regardless of how many bullets or gaps the CV has. Independent layers (bullets + gaps) also run in parallel via `Promise.all`, shaving another round-trip.

The same shape applies to `listCvVersions`: instead of three queries per version, fetch all junctions and all open gaps for every version in two batched queries, then compute the per-version counts in memory.

## One-paragraph summary (for interviews)

> The CV Library's bullets endpoint was taking **5+ seconds** to load because the backend had a classic **N+1 query problem** — for each bullet it issued separate queries for the bullet, its gaps, and each gap's artifacts, all serially. With ~30 bullets that meant ~120 sequential round-trips to the database. I fixed it with **batched queries** (also called *batch fetching*): instead of one query per item, I issued one query per layer using `IN (...)` clauses, then stitched the results together in memory with hash maps keyed by ID. Round-trips dropped from ~120 to **4**, regardless of CV size, and the endpoint went from **~5.3 s to ~200 ms** — roughly a **20–30× speedup**. The same pattern fixed the CV-versions list endpoint (~1 s → ~80 ms).
