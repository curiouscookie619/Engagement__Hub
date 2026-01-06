from datetime import datetime
from pathlib import Path

import pandas as pd

from activity_library import normalise_activity_library
from calendar_engine import CATEGORY_CAPS, run_calendar_engine
from derive import build_customer_profile
from export import export_outputs
from ingest import load_activity_library, load_d365, load_pragati

AS_OF_DATE = datetime(2024, 1, 1)
SAMPLE_DIR = Path("data/sample")
OUTPUT_DIR = Path("data/output")


def _assert_caps(calendar: pd.DataFrame) -> None:
    for (customer, category), group in calendar.groupby(["customer_id", "category"]):
        cap = CATEGORY_CAPS[category]["max_per_year"]
        assert len(group) <= cap, f"Category cap violated for {customer} in {category}: {len(group)}>{cap}"


def _assert_gaps(calendar: pd.DataFrame) -> None:
    dupes = calendar.groupby(["customer_id", "activity_id", "week_bucket"]).size()
    assert (dupes <= 1).all(), "Duplicate activity scheduled within the same week"


def _assert_decision_log(decision_log: pd.DataFrame, profiles: pd.DataFrame, activities: pd.DataFrame) -> None:
    combos = {(c, a) for c in profiles["CustomerID"].unique() for a in activities["ActivityID"].unique()}
    logged = set(zip(decision_log["customer_id"], decision_log["activity_id"]))
    missing = combos - logged
    assert not missing, f"Decision log missing customer/activity entries: {missing}"

    counts = decision_log.groupby(["customer_id", "activity_id"]).size()
    assert (counts == 1).all(), f"Decision log must have exactly one row per customer/activity; found {counts[counts != 1]}"


def main() -> None:
    pragati = load_pragati(str(SAMPLE_DIR / "pragati.csv"))
    d365 = load_d365(str(SAMPLE_DIR / "d365.csv"))
    activity_lib = normalise_activity_library(load_activity_library(str(SAMPLE_DIR / "activity_library.csv")))

    profiles = build_customer_profile(pragati, d365, as_of_date=AS_OF_DATE)
    derived_profile = profiles.copy()

    calendar, decision_log = run_calendar_engine(profiles, activity_lib, reference_date=AS_OF_DATE)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    export_outputs(calendar, decision_log, derived_profile, str(OUTPUT_DIR))

    _assert_caps(calendar)
    _assert_gaps(calendar)
    _assert_decision_log(decision_log, profiles, activity_lib)

    print("Sample run completed with weekly scheduling and variety enforcement.")


if __name__ == "__main__":
    main()
