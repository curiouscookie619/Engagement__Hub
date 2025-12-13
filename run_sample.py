"""Run the sample data through the engine and assert compliance constraints."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

from activity_library import normalise_activity_library
from calendar_engine import CATEGORY_CAPS, run_calendar_engine
from derive import build_customer_profile, profile_columns
from export import export_outputs
from ingest import load_activity_library, load_d365, load_pragati


AS_OF_DATE = datetime(2024, 1, 1)
SAMPLE_DIR = Path("data/sample")
OUTPUT_DIR = Path("data/output")


def _assert_caps(calendar: pd.DataFrame) -> None:
    for (customer, category), group in calendar.groupby(["customer_id", "category"]):
        cap = CATEGORY_CAPS[category]["max_per_year"]
        assert len(group) <= cap, f"Category cap violated for {customer} in {category}: {len(group)}>{cap}"


def _assert_spacing(calendar: pd.DataFrame) -> None:
    bucket_to_date = lambda b: pd.to_datetime(f"{b}-01")
    for (customer, category), group in calendar.groupby(["customer_id", "category"]):
        spacing_days = CATEGORY_CAPS[category]["min_spacing_days"]
        if spacing_days == 0:
            continue
        dates = sorted(bucket_to_date(b) for b in group["month_bucket"].unique())
        min_gap_months = (spacing_days + 29) // 30
        for prev, curr in zip(dates, dates[1:]):
            delta_months = (curr.year - prev.year) * 12 + (curr.month - prev.month)
            assert delta_months >= min_gap_months, f"Spacing violated for {customer} {category}: {delta_months}<{min_gap_months}"


def _assert_precedence(calendar: pd.DataFrame) -> None:
    for (customer, month), group in calendar.groupby(["customer_id", "month_bucket"]):
        categories = set(group["category"])
        if "Servicing" in categories:
            assert categories == {"Servicing"}, f"Servicing precedence violated for {customer} {month}"
        if any("renewal" in sub.lower() for sub in group["sub_category"].dropna()):
            assert "Growth & Review" not in categories, f"Renewal precedence violated for {customer} {month}"


def _assert_decision_log(decision_log: pd.DataFrame, profiles: pd.DataFrame, activities: pd.DataFrame) -> None:
    combos = {(c, a) for c in profiles["CustomerID"].unique() for a in activities["ActivityID"].unique()}
    logged = set(zip(decision_log["customer_id"], decision_log["activity_id"]))
    missing = combos - logged
    assert not missing, f"Decision log missing customer/activity entries: {missing}"

    counts = decision_log.groupby(["customer_id", "activity_id"]).size()
    assert (counts == 1).all(), f"Decision log must have exactly one row per customer/activity; found {counts[counts != 1]}"

    expected_stages = {"ELIGIBILITY", "MODIFIER", "CAP", "SCHEDULE"}
    assert set(decision_log["stage"].unique()).issubset(expected_stages), "Unexpected decision log stages present"


def main() -> None:
    pragati = load_pragati(str(SAMPLE_DIR / "pragati.csv"))
    d365 = load_d365(str(SAMPLE_DIR / "d365.csv"))
    activity_lib = normalise_activity_library(load_activity_library(str(SAMPLE_DIR / "activity_library.csv")))

    profiles = build_customer_profile(pragati, d365, as_of_date=AS_OF_DATE)
    derived_profile = profiles[list(profile_columns())].copy()

    calendar, decision_log = run_calendar_engine(profiles, activity_lib, reference_date=AS_OF_DATE)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    export_outputs(calendar, decision_log, derived_profile, str(OUTPUT_DIR))

    _assert_caps(calendar)
    _assert_spacing(calendar)
    _assert_precedence(calendar)
    _assert_decision_log(decision_log, profiles, activity_lib)

    assert not decision_log.empty, "Decision log should not be empty"
    expected_columns = {"customer_id", "activity_id", "stage", "result", "reason_code"}
    assert expected_columns.issubset(decision_log.columns), "Decision log missing expected columns"

    print("Sample run completed with all caps, spacing, and precedence rules satisfied.")


if __name__ == "__main__":
    main()
