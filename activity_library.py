"""Activity library normalisation and validation helpers."""
from __future__ import annotations

import pandas as pd

from ingest import ValidationError


MULTI_VALUE_FIELDS = {
    "Channels": "channels",
    "SafariPersonaEligibility": "persona_eligibility",
    "LifeStageEligibility": "life_stage_eligibility",
    "RenewalBuckets": "renewal_eligibility",
    "EligiblePTIBands": "pti_eligibility",
    "EligibleCityTiers": "city_eligibility",
    "EligibleOccupationTypes": "occupation_eligibility",
    "EligibleKidsFlags": "kids_flags",
    "EligibleKidsAgeBands": "kids_age_bands",
}


def _split_field(series: pd.Series) -> pd.Series:
    def splitter(value: str) -> list[str]:
        parts = [part.strip() for part in str(value).split("|") if part.strip()]
        return [] if any(part.upper() == "ALL" for part in parts) else parts

    return series.fillna("").apply(splitter)


def normalise_activity_library(df: pd.DataFrame) -> pd.DataFrame:
    library = df.copy()
    for column, new_field in MULTI_VALUE_FIELDS.items():
        library[new_field] = _split_field(library[column])

    for column, new_field in MULTI_VALUE_FIELDS.items():
        original = library[column].fillna("").astype(str).str.strip()
        empty_mask = library[new_field].apply(len).eq(0)
        invalid = empty_mask & ~original.str.upper().eq("ALL")
        if invalid.any():
            raise ValidationError(f"Activity library field '{column}' cannot be empty (use 'ALL' for no restriction).")

    library = library.sort_values(["Priority", "ActivityID"], ascending=[False, True]).reset_index(drop=True)
    return library
