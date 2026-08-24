"""Self-check for the sponsor resolver's Anthropic SDK compatibility.

`python test_sponsor_resolver_sdk.py` — offline. Uses the REAL installed
`anthropic` package's `Messages.create` signature, not a hand-rolled stub —
that distinction is the point of this file.

Production ran `python scripts/resolve_sponsorship.py --all --limit 20` and
got 15 correct no_match results (0 candidates, no model call) plus 5 failures,
all the same:

    TypeError: Messages.create() got an unexpected keyword argument
    'output_config'

`test_sponsor_matching.py` already covers the resolver's guardrails and
prompt-building thoroughly, but every one of its checks runs against
`StubAnthropic`, a hand-written double whose `create(self, **kwargs)` accepts
anything — it could never have caught a real SDK rejecting a real keyword
argument, which is exactly how this bug reached production unnoticed. These
checks close that gap: they inspect the installed `anthropic.Messages.create`
directly, and add the two structured-output scenarios
(malformed output, an explicit no_match with candidates present) that
`test_sponsor_matching.py` does not already cover.
"""

from __future__ import annotations

import inspect
import json

import anthropic

from app.sponsors.resolver import (
    MIN_MATCH_CONFIDENCE,
    _check_structured_output_supported,
    resolve,
)

_failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    status = "ok  " if cond else "FAIL"
    if not cond:
        _failures.append(f"{name} {detail}")
    print(f"[{status}] {name}{('  ' + detail) if detail and not cond else ''}")


COMPANY = {"id": "co-1", "name": "Acme Fintech Ltd", "website": "acme-fintech.co.uk"}
CANDIDATES = [{"id": "lic-1", "organisation_name": "Acme Fintech Limited"}]


# ---------------------------------------------------------------------------
# The literal regression test: the REAL SDK, not a stub, accepts the exact
# keyword argument the resolver sends.
# ---------------------------------------------------------------------------
real_params = inspect.signature(anthropic.Anthropic(api_key="x").messages.create).parameters
check("the installed anthropic SDK's Messages.create accepts output_config",
      "output_config" in real_params,
      f"installed anthropic=={getattr(anthropic, '__version__', '?')}; "
      f"params={sorted(real_params)}")
check("...and the resolver's own guard agrees, raising nothing for it",
      _check_structured_output_supported(anthropic.Anthropic(api_key="x")) is None)


class RealShapedStub:
    """A stub whose `create` has the SAME explicit parameter list as the real
    SDK — no `**kwargs` catch-all — so it exercises the guard the way an
    actually-incompatible installed SDK would, without needing one installed.
    """

    def __init__(self, supports_output_config: bool, payload: dict) -> None:
        self.messages = self
        self._payload = payload
        self.supports_output_config = supports_output_config
        self.calls: list[dict] = []

    def create(self, *, model, max_tokens, messages, system=None, output_config=None):
        # A stub that DOES declare output_config — the "supported" case.
        self.calls.append({"model": model, "output_config": output_config})
        return _stub_message(self._payload)


class OldShapedStub:
    """A stub shaped like a pre-0.77 SDK: no `output_config` parameter at
    all, and no `**kwargs` either — calling it the way the resolver does
    raises the exact TypeError production hit.
    """

    def __init__(self) -> None:
        self.messages = self

    def create(self, *, model, max_tokens, messages, system=None):
        raise AssertionError("should never be reached — the guard must fire first")


check("a stub shaped like a supported SDK passes the guard silently",
      _check_structured_output_supported(RealShapedStub(True, {})) is None)

old_stub = OldShapedStub()
try:
    _check_structured_output_supported(old_stub)
    guard_raised = None
except RuntimeError as exc:
    guard_raised = exc

check("an SDK shaped like the one production hit is caught by the guard",
      guard_raised is not None, "guard did not raise")
check("...with a message naming output_config, not a bare TypeError",
      guard_raised is not None and "output_config" in str(guard_raised))
check("...and pointing at requirements.txt rather than leaving it a mystery",
      guard_raised is not None and "requirements.txt" in str(guard_raised))

# resolve() itself must surface this clearly rather than a bare TypeError —
# and must never reach the network to do it.
try:
    resolve(COMPANY, CANDIDATES, api_key="k", model="m", client=old_stub)
    resolve_raised = None
except Exception as exc:  # noqa: BLE001 — the test decides what it means
    resolve_raised = exc

check("resolve() itself raises the clear RuntimeError, not a bare TypeError",
      isinstance(resolve_raised, RuntimeError), f"got {type(resolve_raised).__name__}")


def _stub_message(payload: dict, *, stop_reason: str = "end_turn"):
    class _Block:
        type = "text"
        text = json.dumps(payload)

    class _RawBlock:
        type = "text"
        text = None

    class _Message:
        pass

    m = _Message()
    m.stop_reason = stop_reason
    m.content = [_Block()] if payload is not None else [_RawBlock()]
    return m


class PayloadStub:
    """`**kwargs`-accepting stub — like test_sponsor_matching.py's — for the
    parsing scenarios below, where only the returned payload varies.
    """

    def __init__(self, text: str) -> None:
        self.messages = self
        self._text = text

    def create(self, **kwargs):
        block = _TextBlock(self._text)

        class _Message:
            stop_reason = "end_turn"
            content = [block]

        return _Message()


class _TextBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


# ---------------------------------------------------------------------------
# A. a match response parses correctly.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({
        "selected_candidate_id": "lic-1", "confidence": 0.9, "decision": "match",
        "matched_on": ["name_exact"], "reasoning": "Clear match.",
    })),
)
check("A: a match response parses", res.decision == "match" and res.selected_candidate_id == "lic-1")

# ---------------------------------------------------------------------------
# B. an ambiguous response parses correctly.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({
        "selected_candidate_id": None, "confidence": 0.5, "decision": "ambiguous",
        "matched_on": [], "reasoning": "Two candidates fit comparably.",
    })),
)
check("B: an ambiguous response parses", res.decision == "ambiguous" and res.selected_candidate_id is None)

# ---------------------------------------------------------------------------
# C. an explicit no_match, WITH candidates present (so the model was actually
#    called), parses correctly — distinct from the no-candidates short-circuit
#    test_sponsor_matching.py already covers.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({
        "selected_candidate_id": None, "confidence": 0.1, "decision": "no_match",
        "matched_on": [], "reasoning": "None of the candidates match.",
    })),
)
check("C: an explicit no_match (candidates were supplied) parses",
      res.decision == "no_match" and res.selected_candidate_id is None)

# ---------------------------------------------------------------------------
# D. malformed model output fails safely — ambiguous, not a crash.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub("this is not { valid json"),
)
check("D: malformed output does not raise", True)  # reaching here is the check
check("D: malformed output fails safe as ambiguous", res.decision == "ambiguous")
check("D: malformed output carries no selection", res.selected_candidate_id is None)
check("D: the reasoning says the output could not be parsed",
      "parsed" in res.reasoning.lower(), f"got {res.reasoning!r}")

# Also: valid JSON that is the wrong shape (missing required fields) must not
# crash the resolver either — _coerce reads with .get(), so this is a real
# path, not a hypothetical.
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({"unexpected": "shape"})),
)
check("D: valid JSON in the wrong shape still fails safe",
      res.decision == "ambiguous" or res.decision == "no_match",
      f"got {res.decision}")

# ---------------------------------------------------------------------------
# E. an unsupported/unknown candidate id is rejected.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({
        "selected_candidate_id": "lic-does-not-exist", "confidence": 0.95,
        "decision": "match", "matched_on": ["name_exact"], "reasoning": "x",
    })),
)
check("E: an id outside the supplied candidates is rejected",
      res.decision == "ambiguous" and res.selected_candidate_id is None,
      f"got {res.decision}/{res.selected_candidate_id}")

# ---------------------------------------------------------------------------
# F. a low-confidence match is downgraded to ambiguous.
# ---------------------------------------------------------------------------
res = resolve(
    COMPANY, CANDIDATES, api_key="k", model="m",
    client=PayloadStub(json.dumps({
        "selected_candidate_id": "lic-1", "confidence": MIN_MATCH_CONFIDENCE - 0.01,
        "decision": "match", "matched_on": ["name_variant"], "reasoning": "Weak.",
    })),
)
check("F: a below-threshold match is downgraded to ambiguous",
      res.decision == "ambiguous", f"got {res.decision}")
check("F: the downgraded match carries no selection", res.selected_candidate_id is None)


print()
if _failures:
    print(f"{len(_failures)} FAILED:")
    for failure in _failures:
        print(f"  - {failure}")
    raise SystemExit(1)
print("ALL SPONSOR RESOLVER SDK COMPATIBILITY TESTS PASSED")
