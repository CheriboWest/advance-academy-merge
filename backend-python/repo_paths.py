"""Where the rest of the repo sits, as seen from this service.

Several self-checks here assert *agreement* between the FastAPI layer and the
web and migration layers — that a route the API exposes has a client calling it,
that a column the code reads exists in a migration. That makes them the tests
most sensitive to the tree moving, and during the career-hub merge the tree
moves twice: `apps/api` -> `backend-python` (done), and `careerhub/apps/web` ->
the merged Next app (Stage 4, still to come).

Each test used to derive its own root with `Path(__file__).resolve().parents[2]`,
which silently became wrong the moment this directory changed depth — six tests
failing with "file not found" for a file that had simply moved. Defining the
layout in one place means the next move edits this file, not six.

ponytail: three constants, no path-resolution helper. Add one when a caller
needs something these don't already give it.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: career-hub's Next.js app. Stage 4 folds it into the repo-root app; when it
#: does, this becomes REPO_ROOT and the `lib/` paths below move under
#: `features/career-hub/`.
WEB_ROOT = REPO_ROOT / "careerhub" / "apps" / "web"

#: This service.
API_ROOT = REPO_ROOT / "backend-python"

#: career-hub's migrations, kept apart from AdvanceAcademyTools' 001-023 until
#: they are renumbered as 024_ch_* onward.
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "careerhub" / "migrations"
