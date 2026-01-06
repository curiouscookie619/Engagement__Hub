"""Data ingestion and validation utilities for Pragati, D365, and the activity library."""
from __future__ import annotations

from datetime import datetime
from typing import List, Set

import pandas as pd


class ValidationError(Exception):
    """Raised when input data fails validation."""


PRAGATI_REQUIRED_COLUMNS = [
    "CustomerID",
    "CustomerName",
    "DOB",
    "PolicyIssuanceDate",
    "PlanType",
    "AnnualPremium",
    "AnnualIncome",
    "PremiumFrequency",
    "PolicyTerm",
    "PremiumPayingTerm",
    "SumAssured",
    "City",
    "PIN",
    "Occupation",
    "NomineeRelationship",
    "NomineeAge",
    "PolicyStatus",
    "LastPremiumDate",
    "NextPremiumDate",
]

PRAGATI_PLAN_TYPES: Set[str] = {"PAR", "NON-PAR", "ULIP"}
PRAGATI_POLICY_STATUS: Set[str] = {"Active", "Lapsed", "PaidUp", "Surrendered"}

D365_REQUIRED_COLUMNS = [
    "CustomerID",
    "SafariPersona",
    "LifeStage",
    "PoliciesPP",
    "PoliciesRPU",
    "PoliciesFPU",
    "PoliciesSurrendered",
    "PoliciesTotalEver",
    "LastEngagementDate",
    "ConsentStatus",
    "PrimaryChannel",
    "SecondaryChannel",
    "RiskTier",
    "RenewalBucket",
    "RecentPCT",
    "RecentCT",
    "RecentST",
]

D365_CONSENT_VALUES: Set[str] = {"OptedIn", "OptedOut"}
D365_RISK_TIERS: Set[str] = {"High", "Medium", "Low"}
D365_SAFARI_PERSONA: Set[str] = {"Lion", "Hawk", "Elephant", "Deer"}
D365_LIFESTAGE: Set[str] = {"Young Adult", "Early Nester", "Mature Nester", "Golden Preserver"}
D365_RENEWAL_BUCKETS: Set[str] = {"13M", "25M", "37M", "49M", "61M", "61+", ""}
D365_KIDS_FLAG: Set[str] = {"Y", "Unsure", "N"}
D365_KIDS_AGE_BAND: Set[str] = {"0-5", "6-15", "16-22", "22+", "Unknown"}
D365_CITY_TIER: Set[str] = {"Metro", "Tier1", "Tier2", "Tier3/4", "Unknown"}
D365_OCCUPATION: Set[str] = {"Salaried", "Business", "Professional", "Retired", "Homemaker", "Student", "Unknown"}
D365_PTI: Set[str] = {"Light", "Comfortable", "Heavy", "Stretched", "Unknown"}

ACTIVITY_REQUIRED_COLUMNS = [
    "ActivityID",
    "ActivityName",
    "Category",
    "SubCategory",
    "LifeStageEligibility",
    "SafariPersonaEligibility",
    "RenewalBuckets",
    "RequiredConsent",
    "Channels",
    "EligiblePTIBands",
    "EligibleCityTiers",
    "EligibleOccupationTypes",
    "EligibleKidsFlags",
    "EligibleKidsAgeBands",
    "MaxSurrenderPct",
    "MinSpacingDays",
    "StartMonthOffset",
    "EndMonthOffset",
    "FrequencyMonths",
    "Priority",
]

ACTIVITY_CONSENT_VALUES: Set[str] = {"Yes", "No"}
ACTIVITY_CATEGORIES: Set[str] = {
    "Everyday Life & Learning",
    "Policy Journey",
    "Trust & Touchpoints",
    "Loyalty, Rewards & Access",
    "Community & Connections",
    "Growth & Review",
    "Maturity",
    "Servicing",
}


def _require_columns(df: pd.DataFrame, required: List[str], source: str) -> None:
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValidationError(f"{source} missing columns: {', '.join(missing)}")


def _validate_enums(df: pd.DataFrame, column: str, allowed: Set[str], source: str) -> None:
    bad_values = sorted({value for value in df[column].dropna().unique() if value not in allowed})
    if bad_values:
        raise ValidationError(
            f"{source} column '{column}' has invalid values: {', '.join(map(str, bad_values))}. "
            f"Allowed: {', '.join(sorted(allowed))}"
        )


def _parse_dates(df: pd.DataFrame, columns: List[str], source: str) -> pd.DataFrame:
    for col in columns:
        try:
            df[col] = pd.to_datetime(df[col], format="%Y-%m-%d", errors="raise")
        except ValueError as exc:
            raise ValidationError(f"{source} column '{col}' has invalid date format. Use YYYY-MM-DD.") from exc
    return df


def _require_numeric(df: pd.DataFrame, columns: List[str], source: str) -> None:
    for field in columns:
        df[field] = pd.to_numeric(df[field], errors="coerce")
        if df[field].isna().any():
            raise ValidationError(f"{source} field '{field}' must be numeric.")


def load_pragati(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)

    # Allow policy-level extracts with record_type + extended fields
    if "record_type" in df.columns:
        policy_df = df[df["record_type"].str.upper() == "POLICY"].copy()
        rename_map = {
            "customer_id": "CustomerID",
            "policy_issuance_date_ymd": "PolicyIssuanceDate",
            "plan_type": "PlanType",
            "annualised_premium": "AnnualPremium",
            "la_annual_income": "AnnualIncome",
            "premium_frequency": "PremiumFrequency",
            "pt": "PolicyTerm",
            "ppt": "PremiumPayingTerm",
            "sam": "SumAssured",
            "la_name": "CustomerName",
            "la_dob_ymd": "DOB",
            "la_occupation": "Occupation",
            "la_city": "City",
            "la_pin": "PIN",
            "nominee_relation": "NomineeRelationship",
            "policy_status": "PolicyStatus",
        }
        policy_df = policy_df.rename(columns=rename_map)

        # Normalise plan/status values
        policy_df["PlanType"] = policy_df["PlanType"].str.replace("_", "-").str.upper()
        policy_df["PlanType"] = policy_df["PlanType"].replace({"PAR": "PAR", "NON-PAR": "NON-PAR", "ULIP": "ULIP"})
        status_map = {"PP": "Active", "RPU": "PaidUp", "FPU": "PaidUp", "Surrendered": "Surrendered"}
        policy_df["PolicyStatus"] = policy_df["PolicyStatus"].replace(status_map)

        # Date parsing (source is DD-MM-YYYY)
        policy_df["PolicyIssuanceDate"] = pd.to_datetime(policy_df["PolicyIssuanceDate"], format="%d-%m-%Y", errors="coerce")
        policy_df["DOB"] = pd.to_datetime(policy_df["DOB"], format="%d-%m-%Y", errors="coerce")

        # Minimal placeholders for required dates
        policy_df["LastPremiumDate"] = policy_df["PolicyIssuanceDate"]
        policy_df["NextPremiumDate"] = policy_df["PolicyIssuanceDate"] + pd.to_timedelta(30, unit="d")

        # Defaults for nominee age if absent
        if "NomineeAge" in policy_df.columns:
            policy_df["NomineeAge"] = policy_df["NomineeAge"].fillna(0)
        else:
            policy_df["NomineeAge"] = 0

        df = policy_df

    _require_columns(df, PRAGATI_REQUIRED_COLUMNS, "Pragati")
    _validate_enums(df, "PlanType", PRAGATI_PLAN_TYPES, "Pragati")
    _validate_enums(df, "PolicyStatus", PRAGATI_POLICY_STATUS, "Pragati")
    df = _parse_dates(df, ["DOB", "PolicyIssuanceDate", "LastPremiumDate", "NextPremiumDate"], "Pragati")
    _require_numeric(df, ["AnnualPremium", "AnnualIncome", "PolicyTerm", "PremiumPayingTerm", "SumAssured", "NomineeAge"], "Pragati")
    return df


def load_d365(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)

    if "record_type" in df.columns:
        policies = df[df["record_type"].str.upper() == "POLICY"].copy()
        srs = df[df["record_type"].str.upper() == "SR"].copy()

        policies["policy_issuance_date_ymd"] = pd.to_datetime(policies["policy_issuance_date_ymd"], format="%d-%m-%Y", errors="coerce")
        policies["la_dob_ymd"] = pd.to_datetime(policies["la_dob_ymd"], format="%d-%m-%Y", errors="coerce")

        def _life_stage_from_age(age: float) -> str:
            if age < 30:
                return "Young Adult"
            if age < 40:
                return "Early Nester"
            if age < 55:
                return "Mature Nester"
            return "Golden Preserver"

        today = pd.Timestamp(datetime.utcnow().date())
        policies["age_years"] = ((today - policies["la_dob_ymd"]).dt.days // 365).fillna(0)

        latest_policy = policies.sort_values("policy_issuance_date_ymd", ascending=False).groupby("customer_id").first()
        status_counts = policies.assign(policy_status=policies["policy_status"].str.upper()).groupby("customer_id")["policy_status"].value_counts().unstack(fill_value=0)

        def _count(status: str, cid: str) -> int:
            return int(status_counts.get(status, pd.Series()).get(cid, 0))

        records = []
        for cid, row in latest_policy.iterrows():
            sr_rows = srs[srs["customer_id"] == cid]
            sr_rows["SR_date"] = pd.to_datetime(sr_rows["SR_date"], format="%d-%m-%Y", errors="coerce")
            latest_sr = sr_rows.sort_values("SR_date", ascending=False).head(1)

            records.append(
                {
                    "CustomerID": cid,
                    "SafariPersona": row.get("SafariPersona", "Lion"),
                    "LifeStage": _life_stage_from_age(float(row.get("age_years", 0))),
                    "PoliciesPP": _count("PP", cid),
                    "PoliciesRPU": _count("RPU", cid),
                    "PoliciesFPU": _count("FPU", cid),
                    "PoliciesSurrendered": _count("SURRENDERED", cid),
                    "PoliciesTotalEver": int(status_counts.loc[cid].sum()) if cid in status_counts.index else 0,
                    "LastEngagementDate": latest_sr["SR_date"].iloc[0] if not latest_sr.empty else today,
                    "ConsentStatus": "OptedIn",
                    "PrimaryChannel": latest_sr["SR_Channel"].iloc[0] if not latest_sr.empty else "Email",
                    "SecondaryChannel": "WhatsApp",
                    "RiskTier": "Medium",
                    "RenewalBucket": str(row.get("renewal_bucket", "")),
                    "RecentPCT": latest_sr["PCT"].iloc[0] if not latest_sr.empty else "Servicing Documents",
                    "RecentCT": latest_sr["CT"].iloc[0] if not latest_sr.empty else "Premium Paid Certificate",
                    "RecentST": latest_sr["ST"].iloc[0] if not latest_sr.empty else "Copy",
                }
            )

        df = pd.DataFrame.from_records(records)

    _require_columns(df, D365_REQUIRED_COLUMNS, "D365")
    _validate_enums(df, "ConsentStatus", D365_CONSENT_VALUES, "D365")
    _validate_enums(df, "RiskTier", D365_RISK_TIERS, "D365")
    _validate_enums(df, "SafariPersona", D365_SAFARI_PERSONA, "D365")
    _validate_enums(df, "LifeStage", D365_LIFESTAGE, "D365")
    _validate_enums(df, "RenewalBucket", D365_RENEWAL_BUCKETS, "D365")
    for derived_field, allowed in (
        ("KidsFlag", D365_KIDS_FLAG),
        ("KidsAgeBand", D365_KIDS_AGE_BAND),
        ("CityTier", D365_CITY_TIER),
        ("OccupationType", D365_OCCUPATION),
        ("PremiumToIncomeBand", D365_PTI),
    ):
        if derived_field in df.columns:
            _validate_enums(df, derived_field, allowed, "D365")
    df = _parse_dates(df, ["LastEngagementDate"], "D365")
    _require_numeric(df, ["PoliciesPP", "PoliciesRPU", "PoliciesFPU", "PoliciesSurrendered", "PoliciesTotalEver"], "D365")
    return df


def load_activity_library(path: str) -> pd.DataFrame:
    """Load the activity library as-is for downstream normalisation."""
    return pd.read_csv(path, sep=",", engine="python")


def timestamp_label() -> str:
    return datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
