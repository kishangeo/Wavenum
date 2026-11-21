"""Vercel entry point: exposes the Wavenum FastAPI app (backend/main.py) as `app`.

Author: Kishan Tiwari <kishantiwari@iitkgp.ac.in>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'backend'))

from main import app  # noqa: E402,F401
