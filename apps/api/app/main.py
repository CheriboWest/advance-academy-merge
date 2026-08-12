"""FastAPI application entrypoint for the CareerHub UK backend."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.routers import ai


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CareerHub UK API",
        version=__version__,
        description="Backend API for CareerHub UK. Currently provides AI outreach generation.",
    )

    # Allow the Vercel frontend origin(s) to call the API from the browser.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(ai.router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
