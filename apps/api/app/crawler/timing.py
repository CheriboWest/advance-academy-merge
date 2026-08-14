"""Lightweight stage timing for the crawl pipeline.

Uses ``time.perf_counter`` and logs each stage's wall-clock duration to stdout
so timings are visible in the server logs regardless of the uvicorn log level.
"""

from __future__ import annotations

import logging
import sys
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger("careerhub.crawler.timing")
if not logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("[crawl-timing] %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def log_stage(name: str, seconds: float, extra: str = "") -> None:
    logger.info("%-22s %8.1f ms %s", name, seconds * 1000.0, extra)


@contextmanager
def stage(name: str, extra: str = "") -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        log_stage(name, time.perf_counter() - start, extra)
