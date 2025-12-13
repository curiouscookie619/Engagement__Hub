import pandas as pd
from datetime import datetime
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parent.parent))

import calendar_engine
from calendar_engine import run_calendar_engine
from derive import build_customer_profile


def make_customer(**overrides):
    base = {
        "CustomerID": "C100",
        "LifeStage": "Early Nester",
        "SafariPersona": "Lion",
        "RenewalBucket": "13M",
        "PreferredChannel": "Email",
        "SecondaryChannel": "Call",
        "PremiumToIncomeBand": "Comfortable",
        "CityTier": "Metro",
        "OccupationType": "Salaried",
        "KidsFlag": "Y",
        "KidsAgeBand": "6-15",
        "PercentSurrenders": 0.0,
    }
    base.update(overrides)
    return pd.DataFrame([base])


def make_activity(**overrides):
    base = {
        "ActivityID": "A1",
        "ActivityName": "Test",
        "Category": "Policy Journey",
        "SubCategory": "Renewal Outreach",
        "life_stage_eligibility": ["Early Nester"],
        "persona_eligibility": ["Lion"],
        "renewal_eligibility": ["13M"],
        "channels": ["Email"],
        "pti_eligibility": ["Comfortable"],
        "city_eligibility": ["Metro"],
        "occupation_eligibility": ["Salaried"],
        "kids_flags": ["Y"],
        "kids_age_bands": ["6-15"],
        "MaxSurrenderPct": 1.0,
        "MinSpacingDays": 0,
        "StartMonthOffset": 0,
        "EndMonthOffset": 0,
        "FrequencyMonths": 1,
        "Priority": 3,
    }
    base.update(overrides)
    return pd.DataFrame([base])


def test_derived_profile_bandings():
    pragati = pd.DataFrame(
        [
            {
                "CustomerID": "C900",
                "CustomerName": "Test Customer",
                "DOB": pd.to_datetime("1980-01-01"),
                "PolicyIssuanceDate": pd.to_datetime("2022-01-15"),
                "PlanType": "PAR",
                "AnnualPremium": 50000,
                "AnnualIncome": 500000,
                "PremiumFrequency": "Annual",
                "PolicyTerm": 10,
                "PremiumPayingTerm": 5,
                "SumAssured": 1000000,
                "City": "Mumbai",
                "PIN": "400001",
                "Occupation": "Salaried",
                "NomineeRelationship": "Son",
                "NomineeAge": 10,
                "PolicyStatus": "Active",
                "LastPremiumDate": pd.to_datetime("2023-01-15"),
                "NextPremiumDate": pd.to_datetime("2024-01-15"),
            }
        ]
    )
    d365 = pd.DataFrame(
        [
            {
                "CustomerID": "C900",
                "SafariPersona": "Lion",
                "LifeStage": "Early Nester",
                "PoliciesPP": 1,
                "PoliciesRPU": 0,
                "PoliciesFPU": 0,
                "PoliciesSurrendered": 0,
                "PoliciesTotalEver": 1,
                "LastEngagementDate": pd.to_datetime("2023-01-01"),
                "ConsentStatus": "OptedIn",
                "PrimaryChannel": "Email",
                "SecondaryChannel": "Call",
                "RiskTier": "Medium",
                "RenewalBucket": "",
                "RecentPCT": "Servicing Documents",
                "RecentCT": "Premium Paid Certificate",
                "RecentST": "Copy",
            }
        ]
    )

    profile = build_customer_profile(pragati, d365, as_of_date=datetime(2024, 1, 15))
    row = profile.iloc[0]

    assert row["PremiumToIncomeBand"] == "Heavy"
    assert row["PolicyVintage"] in {"1-3Y", "0-1Y"}
    assert row["CityTier"] == "Metro"
    assert row["KidsFlag"] == "Y" and row["KidsAgeBand"] == "6-15"
    assert row["RenewalBucket"] == "13M"


def test_persona_cap_enforced(monkeypatch):
    monkeypatch.setitem(calendar_engine.SAFARI_CAPS, "Lion", 1)
    customer = make_customer()
    activities = pd.concat(
        [
            make_activity(ActivityID="A1", StartMonthOffset=0),
            make_activity(ActivityID="A2", StartMonthOffset=1, SubCategory="Another"),
        ],
        ignore_index=True,
    )
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    assert len(calendar) == 1
    assert "FAIL_PERSONA_CAP" in log["reason_code"].values


def test_spacing_respected():
    customer = make_customer()
    activities = make_activity(MinSpacingDays=40, EndMonthOffset=1, FrequencyMonths=1)
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    assert len(calendar) == 1


def test_precedence_rules():
    customer_servicing = make_customer(CustomerID="C200", SafariPersona="Lion")
    servicing_activity = make_activity(
        ActivityID="S1",
        Category="Servicing",
        SubCategory="SR",
        MinSpacingDays=0,
        persona_eligibility=["Lion"],
    )
    trust_activity = make_activity(
        ActivityID="T1",
        Category="Trust & Touchpoints",
        SubCategory="Check",
        MinSpacingDays=0,
        persona_eligibility=["Lion"],
    )

    customer_renewal = make_customer(CustomerID="C201", SafariPersona="Elephant")
    renewal_activity = make_activity(
        ActivityID="R1",
        SubCategory="Renewal Outreach",
        persona_eligibility=["Elephant"],
    )
    growth_activity = make_activity(
        ActivityID="G1",
        Category="Growth & Review",
        SubCategory="Portfolio Review",
        persona_eligibility=["Elephant"],
    )

    customers = pd.concat([customer_servicing, customer_renewal]).reset_index(drop=True)
    activities = pd.concat(
        [servicing_activity, trust_activity, renewal_activity, growth_activity],
        ignore_index=True,
    )

    calendar, log = run_calendar_engine(customers, activities, reference_date=datetime(2024, 1, 1))

    servicing_rows = calendar[calendar["customer_id"] == "C200"]
    assert (servicing_rows["category"] == "Servicing").all()
    assert "OVERRIDE_SERVICING" in log[log["customer_id"] == "C200"]["reason_code"].values

    renewal_rows = calendar[calendar["customer_id"] == "C201"]
    assert "Growth & Review" not in renewal_rows["category"].values
    assert "OVERRIDE_RENEWAL_OVER_GROWTH" in log[log["customer_id"] == "C201"]["reason_code"].values


def test_safari_cap_overrides_life_stage(monkeypatch):
    monkeypatch.setitem(calendar_engine.SAFARI_CAPS, "Lion", 3)
    monkeypatch.setitem(calendar_engine.LIFE_STAGE_CAPS, "Early Nester", 1)
    customer = make_customer()
    activities = pd.concat(
        [
            make_activity(ActivityID="A1", StartMonthOffset=0),
            make_activity(ActivityID="A2", StartMonthOffset=1, SubCategory="Another"),
            make_activity(ActivityID="A3", StartMonthOffset=2, SubCategory="Third"),
        ],
        ignore_index=True,
    )
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    assert len(calendar) == 3
    persona_log = log[log["reason_code"] == "FAIL_PERSONA_CAP"]
    assert persona_log.empty


def test_servicing_collision_logs_override():
    customer = make_customer(CustomerID="C300")
    servicing = make_activity(
        ActivityID="PJ1",
        Category="Policy Journey",
        SubCategory="Servicing Touchpoint",
        StartMonthOffset=0,
        EndMonthOffset=0,
        MinSpacingDays=0,
        persona_eligibility=["Lion"],
    )
    engagement = make_activity(
        ActivityID="ELL1",
        Category="Everyday Life & Learning",
        SubCategory="Family Engagement",
        StartMonthOffset=0,
        EndMonthOffset=0,
        MinSpacingDays=0,
        persona_eligibility=["Lion"],
    )
    activities = pd.concat([servicing, engagement], ignore_index=True)
    calendar, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    assert len(calendar) == 1
    assert (calendar.iloc[0]["category"] == "Policy Journey")
    engagement_row = log[(log["customer_id"] == "C300") & (log["activity_id"] == "ELL1")]
    assert not engagement_row.empty
    assert engagement_row.iloc[0]["result"] == "DEFERRED"
    assert engagement_row.iloc[0]["reason_code"] == "OVERRIDE_SERVICING"


def test_decision_log_has_single_row_per_activity():
    customer = make_customer()
    activities = pd.concat(
        [
            make_activity(ActivityID="A1", StartMonthOffset=0),
            make_activity(ActivityID="A2", StartMonthOffset=0, persona_eligibility=["Hawk"]),
        ],
        ignore_index=True,
    )
    _, log = run_calendar_engine(customer, activities, reference_date=datetime(2024, 1, 1))
    expected = {(customer.iloc[0]["CustomerID"], act) for act in ["A1", "A2"]}
    observed = set(zip(log["customer_id"], log["activity_id"]))
    assert expected == observed
    assert all(log.groupby(["customer_id", "activity_id"]).size() == 1)
