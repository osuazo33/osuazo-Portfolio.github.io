"""Shared database connection. DATABASE_URL comes from the environment or from .env
at the repo root; it is never printed."""
import os
import pathlib

import psycopg
from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parent.parent / ".env")


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (add it to .env or the environment).")
    try:
        return psycopg.connect(url, connect_timeout=20)
    except psycopg.OperationalError as e:
        # The driver message can echo the host; never the full URL or password.
        raise SystemExit(f"Could not connect to the database: {type(e).__name__}") from None
