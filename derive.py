"""Customer profile derivation logic aligned to the authoritative derived layer."""
from __future__ import annotations

from datetime import datetime
from typing import Tuple

import pandas as pd

from ingest import ValidationError


PTI_BANDS = [
    (0, 0.05, "Light"),
    (0.05, 0.1, "Comfortable"),
    (0.1, 0.2, "Heavy"),
    (0.2, float("inf"), "Stretched"),
]

POLICY_VINTAGE_BUCKETS = [
    (0, 365, "0-1Y"),
    (366, 3 * 365, "1-3Y"),
    (3 * 365 + 1, 5 * 365, "3-5Y"),
    (5 * 365 + 1, float("inf"), "5Y+"),
]

CITY_TIER_MAP = {
    "Mumbai": "Metro",
    "Delhi": "Metro",
    "Bengaluru": "Metro",
    "Chennai": "Metro",
    "Hyderabad": "Metro",
    "Pune": "Tier1",
    "Ahmedabad": "Tier1",
}

OCCUPATION_MAP = {
    "Salaried": "Salaried",
    "Business": "Business",
    "Professional": "Professional",
    "Retired": "Retired",
    "Homemaker": "Homemaker",
    "Student": "Student",
}

KIDS_RELATIONSHIPS = {"Son", "Daughter", "Child"}


def _coerce_unique(df: pd.DataFrame, key: str, source: str) -> None:
    duplicates = df[df.duplicated(subset=[key], keep=False)][key].unique()
    if len(duplicates):
        dup_list = ", ".join(sorted(map(str, duplicates)))
        raise ValidationError(f"{source} has duplicate {key} values: {dup_list}")


def _band_value(value: float, bands) -> str:
    for lower, upper, label in bands:
        if lower <= value < upper:
            return label
    return bands[-1][2]


def _policy_vintage(issue_date: pd.Timestamp, today: pd.Timestamp) -> str:
    days = (today - issue_date).days
    return _band_value(days, POLICY_VINTAGE_BUCKETS)


def _city_to_tier(city: str) -> str:
    if not city or pd.isna(city):
        return "Unknown"
    return CITY_TIER_MAP.get(city, "Tier3/4")


def _kids_flag_and_band(relationship: str | None, nominee_age: float | None) -> Tuple[str, str]:
    if relationship in KIDS_RELATIONSHIPS:
        if nominee_age is None or pd.isna(nominee_age):
            return "Y", "Unknown"
        if nominee_age <= 5:
            return "Y", "0-5"
        if nominee_age <= 15:
            return "Y", "6-15"
        if nominee_age <= 22:
            return "Y", "16-22"
        return "Y", "22+"
    return "Unsure", "Unknown"


def _occupation_type(raw: str) -> str:
    if not raw or pd.isna(raw):
        return "Unknown"
    return OCCUPATION_MAP.get(raw, "Unknown")


def _derive_renewal_bucket(policy_months: int, provided: str | None) -> str:
    if provided and isinstance(provided, str) and provided.strip():
        return provided
    if policy_months <= 24:
        return "13M"
    if policy_months <= 36:
        return "25M"
    if policy_months <= 48:
        return "37M"
    if policy_months <= 60:
        return "49M"
    if policy_months <= 72:
        return "61M"
    return "61+"


def _pti_band(premium: float, income: float) -> str:
    if pd.isna(income) or income <= 0:
        return "Unknown"
    ratio = premium / income
    return _band_value(ratio, PTI_BANDS)


def build_customer_profile(pragati_df: pd.DataFrame, d365_df: pd.DataFrame, as_of_date: datetime | None = None) -> pd.DataFrame:
    # Aggregate Pragati at customer level when multiple policies exist
    if pragati_df.duplicated(subset=["CustomerID"]).any():
        aggregated = []
        for customer_id, group in pragati_df.groupby("CustomerID"):
            ordered = group.sort_values("PolicyIssuanceDate", ascending=False)
            base = ordered.iloc[0].copy()
            base["AnnualPremium"] = group["AnnualPremium"].sum()
            base["AnnualIncome"] = group["AnnualIncome"].max()
            base["PolicyIssuanceDate"] = ordered["PolicyIssuanceDate"].iloc[0]
            base["RelationshipStart"] = group["PolicyIssuanceDate"].min()
            base["NomineeRelationship"] = group["NomineeRelationship"].dropna().iloc[0]
            base["NomineeAge"] = group["NomineeAge"].fillna(0).max()
            aggregated.append(base)
        pragati_df = pd.DataFrame(aggregated)
    else:
        pragati_df = pragati_df.copy()
        pragati_df["RelationshipStart"] = pragati_df["PolicyIssuanceDate"]

    _coerce_unique(d365_df, "CustomerID", "D365")

    merged = pd.merge(pragati_df, d365_df, on="CustomerID", how="inner", suffixes=("_Pragati", "_D365"))
    if merged.empty:
        raise ValidationError("No overlapping customers between Pragati and D365 extracts.")

    if "SafariPersona_D365" in merged.columns:
        merged["SafariPersona"] = merged["SafariPersona_D365"]

    today = pd.Timestamp(as_of_date.date() if as_of_date else datetime.utcnow().date())
    merged["Age"] = ((today - merged["DOB"]).dt.days // 365).astype(int)

    merged["PremiumToIncomeBand"] = merged.apply(
        lambda row: _pti_band(float(row["AnnualPremium"]), float(row["AnnualIncome"])), axis=1
    )

    merged["PolicyVintage"] = merged["PolicyIssuanceDate"].apply(lambda d: _policy_vintage(d, today))
    merged["RelationshipVintage"] = merged["RelationshipStart"].apply(lambda d: _policy_vintage(d, today))

    merged["CityTier"] = merged["City"].apply(_city_to_tier)
    merged["OccupationType"] = merged["Occupation"].apply(_occupation_type)

    merged["KidsFlag"], merged["KidsAgeBand"] = zip(*merged.apply(
        lambda row: _kids_flag_and_band(row.get("NomineeRelationship"), row.get("NomineeAge")), axis=1
    ))

    merged["PercentSurrenders"] = merged.apply(
        lambda row: 0 if row["PoliciesTotalEver"] == 0 else row["PoliciesSurrendered"] / row["PoliciesTotalEver"],
        axis=1,
    )

    merged["RenewalBucket"] = merged.apply(
        lambda row: _derive_renewal_bucket(
            policy_months=max(((today - row["PolicyIssuanceDate"]).days // 30), 0),
            provided=row.get("RenewalBucket"),
        ),
        axis=1,
    )

    merged["PortfolioComposition"] = merged.apply(
        lambda row: {
            "PP": int(row["PoliciesPP"]),
            "RPU": int(row["PoliciesRPU"]),
            "FPU": int(row["PoliciesFPU"]),
            "Surrendered": int(row["PoliciesSurrendered"]),
        },
        axis=1,
    )

    merged["PreferredChannel"] = merged.apply(
        lambda row: "No Contact" if row["ConsentStatus"] == "OptedOut" else row["PrimaryChannel"], axis=1
    )

    merged = merged.sort_values("CustomerID").reset_index(drop=True)
    return merged


def profile_columns() -> Tuple[str, ...]:
    return (
        "CustomerID",
        "CustomerName",
        "Age",
        "LifeStage",
        "SafariPersona",
        "PolicyVintage",
        "RelationshipVintage",
        "PremiumToIncomeBand",
        "RenewalBucket",
        "CityTier",
        "OccupationType",
        "KidsFlag",
        "KidsAgeBand",
        "PercentSurrenders",
        "PreferredChannel",
    )
