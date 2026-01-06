"""Export utilities for calendar outputs."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Tuple

import pandas as pd

from ingest import timestamp_label


def _ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def export_outputs(
    calendar: pd.DataFrame, decision_log: pd.DataFrame, derived_profile: pd.DataFrame, base_path: str
) -> Tuple[str, str, str, str, str, str]:
    ts = timestamp_label()
    base = Path(base_path)
    _ensure_dir(base)

    calendar_csv = base / f"engagement_calendar_{ts}.csv"
    decision_csv = base / f"decision_log_{ts}.csv"
    derived_csv = base / f"derived_profile_{ts}.csv"
    calendar_json = base / f"engagement_calendar_{ts}.json"
    decision_json = base / f"decision_log_{ts}.json"
    derived_json = base / f"derived_profile_{ts}.json"

    calendar.to_csv(calendar_csv, index=False)
    decision_log.to_csv(decision_csv, index=False)
    derived_profile.to_csv(derived_csv, index=False)

    calendar.to_json(calendar_json, orient="records", date_format="iso")
    decision_log.to_json(decision_json, orient="records", date_format="iso")
    derived_profile.to_json(derived_json, orient="records", date_format="iso")

    return (
        str(calendar_csv),
        str(calendar_json),
        str(decision_csv),
        str(decision_json),
        str(derived_csv),
        str(derived_json),
    )
