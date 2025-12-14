"""Activity library normalisation and validation helpers for the weekly engine."""
from __future__ import annotations

from math import ceil
from typing import Dict, List

import pandas as pd

from ingest import ValidationError


REQUIRED_COLUMNS = [
    "activity_id",
    "activity_name",
    "category",
    "sub_category",
    "theme",
    "eligible_life_stages",
    "eligible_safari_personas",
    "allowed_premium_to_income_bands",
    "allowed_city_tiers",
    "allowed_occupation_types",
    "allowed_renewal_buckets",
    "allowed_channels",
    "preferred_channel",
    "business_priority",
    "min_gap_days_same_activity",
    "min_gap_days_same_theme",
    "variety_key",
    "repeat_penalty_mode",
]


def _split_pipe(value: str) -> List[str]:
    parts = [part.strip() for part in str(value).split("|") if part.strip()]
    if any(part.upper() == "ALL" for part in parts):
        return []
    return parts


def _bool_from_string(value: str | bool) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().upper() == "TRUE"


def _ceil_weeks(days: int | float) -> int:
    try:
        return int(ceil(float(days) / 7.0))
    except Exception as exc:  # pragma: no cover - defensive
        raise ValidationError(f"Invalid day value for gap conversion: {days}") from exc


def normalise_activity_library(df: pd.DataFrame) -> pd.DataFrame:
    missing = [col for col in REQUIRED_COLUMNS if col not in df.columns]
    if missing:
        raise ValidationError(f"Activity library missing columns: {', '.join(missing)}")

    lib = df.copy()

    lib["activity_id"] = lib["activity_id"].astype(str)
    lib["business_priority"] = pd.to_numeric(lib["business_priority"], errors="coerce")
    if lib["business_priority"].isna().any():
        raise ValidationError("business_priority must be numeric")

    lib["requires_kids"] = lib["requires_kids"].apply(_bool_from_string) if "requires_kids" in lib.columns else False
    lib["requires_human"] = lib["requires_human"].apply(_bool_from_string)

    lib["channels"] = lib["allowed_channels"].fillna("").apply(_split_pipe)
    if lib["channels"].apply(len).eq(0).any():
        raise ValidationError("allowed_channels must not be empty; use ALL if unrestricted")

    # Eligibility lists
    lib["life_stage_eligibility"] = lib["eligible_life_stages"].fillna("").apply(_split_pipe)
    lib["persona_eligibility"] = lib["eligible_safari_personas"].fillna("").apply(_split_pipe)
    lib["renewal_eligibility"] = lib["allowed_renewal_buckets"].fillna("").apply(_split_pipe)
    lib["pti_eligibility"] = lib["allowed_premium_to_income_bands"].fillna("").apply(_split_pipe)
    lib["city_eligibility"] = lib["allowed_city_tiers"].fillna("").apply(_split_pipe)
    lib["occupation_eligibility"] = lib["allowed_occupation_types"].fillna("").apply(_split_pipe)
    lib["kids_age_bands"] = lib.get("allowed_kids_age_bands", "").fillna("").apply(_split_pipe)

    def kids_flags(row: pd.Series) -> List[str]:
        if row.get("requires_kids"):
            return ["Y"]
        return []

    lib["kids_flags"] = lib.apply(kids_flags, axis=1)

    lib["min_gap_activity_weeks"] = lib["min_gap_days_same_activity"].fillna(0).apply(_ceil_weeks)
    lib["min_gap_theme_weeks"] = lib["min_gap_days_same_theme"].fillna(0).apply(_ceil_weeks)

    lib["repeat_penalty_mode"] = lib["repeat_penalty_mode"].str.upper().replace({"": "HARD"})

    normalised = lib.rename(
        columns={
            "activity_id": "ActivityID",
            "activity_name": "ActivityName",
            "category": "Category",
            "sub_category": "SubCategory",
            "theme": "Theme",
            "business_priority": "Priority",
            "preferred_channel": "PreferredChannel",
            "variety_key": "VarietyKey",
        }
    )

    cols_to_keep = [
        "ActivityID",
        "ActivityName",
        "Category",
        "SubCategory",
        "Theme",
        "Priority",
        "channels",
        "PreferredChannel",
        "requires_human",
        "life_stage_eligibility",
        "persona_eligibility",
        "renewal_eligibility",
        "pti_eligibility",
        "city_eligibility",
        "occupation_eligibility",
        "kids_flags",
        "kids_age_bands",
        "min_gap_activity_weeks",
        "min_gap_theme_weeks",
        "VarietyKey",
        "repeat_penalty_mode",
    ]

    missing_after = [col for col in cols_to_keep if col not in normalised.columns]
    if missing_after:
        raise ValidationError(f"Activity library normalisation failed; missing {missing_after}")

    return normalised.sort_values(["Priority", "ActivityID"], ascending=[False, True]).reset_index(drop=True)
