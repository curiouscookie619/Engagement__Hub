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


def test_planning_horizon_defaults_to_annual():
    customer = make_customer()
    activity = make_activity("SVC", "svc", penalty_mode="SOFT", priority=3, Category="Servicing")
    from calendar_engine import SAFARI_CAPS

    old_cap = SAFARI_CAPS[customer.loc[0, "SafariPersona"]]
    SAFARI_CAPS[customer.loc[0, "SafariPersona"]] = 100
    try:
        calendar, _ = run_calendar_engine(customer, activity, reference_date=datetime(2024, 1, 1))
    finally:
        SAFARI_CAPS[customer.loc[0, "SafariPersona"]] = old_cap

    assert calendar["week_bucket"].nunique() == 52


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


def test_soft_allows_same_month_with_penalty_and_hard_blocks():
    customer = make_customer()
    soft1 = make_activity("S1", "VK", penalty_mode="SOFT", priority=3, min_gap_activity_weeks=2)
    soft2 = make_activity("S2", "VK", penalty_mode="SOFT", priority=2)
    soft_calendar, _ = run_calendar_engine(
        customer, pd.concat([soft1, soft2], ignore_index=True), reference_date=datetime(2024, 1, 1), planning_weeks=4
    )
    assert set(soft_calendar["activity_id"].head(2)) == {"S1", "S2"}

    hard1 = make_activity("H1", "VK2", penalty_mode="HARD", priority=3)
    hard2 = make_activity("H2", "VK2", penalty_mode="HARD", priority=2)
    _, log = run_calendar_engine(
        customer, pd.concat([hard1, hard2], ignore_index=True), reference_date=datetime(2024, 1, 1), planning_weeks=4
    )
    hard_block = log[(log["activity_id"] == "H2") & (log["reason_code"] == "FAIL_VARIETY_KEY_MONTH_HARD")]
    assert not hard_block.empty


def test_gap_rules_enforced():
    customer = make_customer()
    act = make_activity("A1", "K4", penalty_mode="HARD", priority=2, min_gap_activity_weeks=4)
    activities = pd.concat([act], ignore_index=True)
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    # With annual horizon and 4-week gap, should schedule at most 13 times
    assert len(calendar) <= 13
    parsed_weeks = pd.to_datetime(calendar["week_bucket"] + "-1", format="%G-W%V-%u")
    diffs = parsed_weeks.sort_values().diff().dropna().dt.days
    assert (diffs >= 28).all()


def test_reason_codes_include_base_signals():
    customer = make_customer()
    act = make_activity("A1", "V1", penalty_mode="HARD", priority=3)
    calendar, _ = run_calendar_engine(customer, act, reference_date=datetime(2024, 1, 1))
    assert "PASS_ELIGIBILITY" in calendar.iloc[0]["reason_codes"]
    assert "PASS_MODIFIER" in calendar.iloc[0]["reason_codes"]


def test_channel_owner_mapping_enforced():
    customer = make_customer()
    # requires human but only digital channels -> excluded
    act = make_activity("A1", "V1", penalty_mode="HARD", priority=3, requires_human=True, channels=["Email"], PreferredChannel="Email")
    _, log = run_calendar_engine(customer, act, reference_date=datetime(2024, 1, 1))
    failure = log[(log["activity_id"] == "A1") & (log["reason_code"] == "FAIL_CHANNEL_OWNER_MAPPING")]
    assert not failure.empty


def test_channel_owner_outputs_are_canonical():
    customer = make_customer()
    a1 = make_activity("D1", "k1", channels=["Email"], PreferredChannel="Email")
    a2 = make_activity("H1", "k2", channels=["Telecalling"], PreferredChannel="Telecalling", requires_human=True)
    calendar, _ = run_calendar_engine(customer, pd.concat([a1, a2], ignore_index=True), reference_date=datetime(2024, 1, 1))

    invalid = calendar[
        (calendar["channel"].isin(["Email", "WhatsApp", "Portal", "SMS"]))
        & (calendar["owner_type"].isin(["Field", "RM", "BranchOps"]))
    ]
    assert invalid.empty


def test_allowed_channels_all_normalises():
    from activity_library import normalise_activity_library
    import pandas as pd

    df = pd.DataFrame(
        [
            {
                "activity_id": "A1",
                "activity_name": "Test",
                "category": "Everyday Life & Learning",
                "sub_category": "Sub",
                "theme": "Th",
                "eligible_life_stages": "ALL",
                "eligible_safari_personas": "ALL",
                "allowed_premium_to_income_bands": "ALL",
                "allowed_city_tiers": "ALL",
                "allowed_occupation_types": "ALL",
                "allowed_renewal_buckets": "ALL",
                "allowed_channels": "ALL",
                "preferred_channel": "Email",
                "business_priority": 1,
                "min_gap_days_same_activity": 0,
                "min_gap_days_same_theme": 0,
                "repeat_penalty_mode": "HARD",
                "variety_key": "k",
                "requires_human": False,
                "requires_kids": False,
                "allowed_kids_age_bands": "ALL",
            }
        ]
    )

    normalised = normalise_activity_library(df)
    channels = set(normalised.loc[0, "channels"])
    assert {"WhatsApp", "Email", "Portal", "Telecalling", "RMVisit", "Branch", "SMS", "Event / Webinar"}.issubset(channels)


def test_life_stage_cap_when_persona_missing():
    customer = make_customer(SafariPersona="", LifeStage="Young Adult")
    act = make_activity(
        "CAP",
        "cap",
        penalty_mode="SOFT",
        priority=5,
        Category="Servicing",
        min_gap_activity_weeks=0,
        life_stage_eligibility=[],
        persona_eligibility=[],
    )
    calendar, log = run_calendar_engine(customer, act, reference_date=datetime(2024, 1, 1), planning_weeks=60)

    assert len(calendar) == 20  # Young Adult life-stage cap
    included = log[(log["activity_id"] == "CAP") & (log["result"] == "INCLUDED")]
    assert "cap_source=LIFESTAGE" in included.iloc[0]["details"]


def test_safari_cap_overrides_life_stage():
    customer = make_customer(SafariPersona="Hawk", LifeStage="Young Adult")
    act = make_activity(
        "CAP",
        "cap",
        penalty_mode="SOFT",
        priority=5,
        Category="Servicing",
        min_gap_activity_weeks=0,
        life_stage_eligibility=[],
        persona_eligibility=[],
    )
    calendar, log = run_calendar_engine(customer, act, reference_date=datetime(2024, 1, 1), planning_weeks=60)

    assert len(calendar) == 28  # Hawk cap
    included = log[(log["activity_id"] == "CAP") & (log["result"] == "INCLUDED")]
    assert "cap_source=SAFARI" in included.iloc[0]["details"]


def test_cap_fallback_default_with_warning():
    customer = make_customer(SafariPersona="", LifeStage="")
    act = make_activity(
        "CAP",
        "cap",
        penalty_mode="SOFT",
        priority=5,
        Category="Servicing",
        min_gap_activity_weeks=0,
        life_stage_eligibility=[],
        persona_eligibility=[],
    )
    calendar, log = run_calendar_engine(customer, act, reference_date=datetime(2024, 1, 1), planning_weeks=60)

    assert len(calendar) == 18
    included = log[(log["activity_id"] == "CAP") & (log["result"] == "INCLUDED")]
    assert "cap_source=DEFAULT" in included.iloc[0]["details"]
    assert "WARN_CAP_FALLBACK_DEFAULT" in included.iloc[0]["details"] or "WARN_CAP_FALLBACK_DEFAULT" in "|".join(calendar["reason_codes"])
