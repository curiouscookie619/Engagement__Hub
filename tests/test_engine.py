from datetime import datetime
from pathlib import Path
import sys

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parent.parent))

from calendar_engine import run_calendar_engine


def make_customer(**overrides):
    base = {
        "CustomerID": "C1",
        "LifeStage": "Early Nester",
        "SafariPersona": "Lion",
        "RenewalBucket": "13M",
        "PremiumToIncomeBand": "Comfortable",
        "CityTier": "Metro",
        "OccupationType": "Salaried",
        "KidsFlag": "Y",
        "KidsAgeBand": "6-15",
        "PercentSurrenders": 0.0,
    }
    base.update(overrides)
    return pd.DataFrame([base])


def make_activity(activity_id: str, variety_key: str, penalty_mode: str = "HARD", priority: int = 2, **kwargs):
    base = {
        "ActivityID": activity_id,
        "ActivityName": activity_id,
        "Category": "Everyday Life & Learning",
        "SubCategory": "Test",
        "Theme": "T",
        "Priority": priority,
        "channels": ["Email"],
        "PreferredChannel": "Email",
        "requires_human": False,
        "life_stage_eligibility": ["Early Nester"],
        "persona_eligibility": ["Lion"],
        "renewal_eligibility": [],
        "pti_eligibility": [],
        "city_eligibility": [],
        "occupation_eligibility": [],
        "kids_flags": [],
        "kids_age_bands": [],
        "min_gap_activity_weeks": 0,
        "min_gap_theme_weeks": 0,
        "VarietyKey": variety_key,
        "repeat_penalty_mode": penalty_mode,
    }
    base.update(kwargs)
    return pd.DataFrame([base])


def test_hard_variety_excludes_same_month():
    customer = make_customer()
    a1 = make_activity("A1", "K1", penalty_mode="HARD")
    a2 = make_activity("A2", "K1", penalty_mode="HARD")
    activities = pd.concat([a1, a2], ignore_index=True)
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))

    # Only one of the two with the same variety_key in the month is scheduled
    assert calendar["activity_id"].nunique() == 1
    excluded = log[(log["activity_id"] == "A2") & (log["reason_code"] == "FAIL_VARIETY_KEY_MONTH_HARD")]
    assert not excluded.empty


def test_soft_variety_penalty_diverts_to_alternative():
    customer = make_customer()
    # Two weeks; soft penalty should push selection to A2 on week 2
    a1 = make_activity("A1", "K2", penalty_mode="SOFT", priority=2)
    a2 = make_activity("A2", "K3", penalty_mode="SOFT", priority=1)
    activities = pd.concat([a1, a2], ignore_index=True)
    calendar, _ = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    # First week picks higher priority A1; second week should pick A2 due to soft penalty on A1
    assert set(calendar["activity_id"].head(2)) == {"A1", "A2"}


def test_gap_rules_enforced():
    customer = make_customer()
    act = make_activity("A1", "K4", penalty_mode="HARD", priority=2, min_gap_activity_weeks=4)
    activities = pd.concat([act], ignore_index=True)
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    # With 12-week horizon and 4-week gap, should schedule at most 3 times
    assert len(calendar) <= 3
    weeks = pd.to_datetime(calendar["week_bucket"].str.replace("W", "-", regex=False))
    diffs = weeks.sort_values().diff().dropna().dt.days
    assert (diffs >= 28).all()
