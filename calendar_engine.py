"""Stage 1 calendarisation engine with deterministic ordering and decision logging."""
from __future__ import annotations

from datetime import datetime
from math import ceil
from typing import Dict, List, Tuple

import pandas as pd


CATEGORY_CAPS = {
    "Everyday Life & Learning": {"max_per_year": 8, "min_spacing_days": 7},
    "Policy Journey": {"max_per_year": 8, "min_spacing_days": 5},
    "Trust & Touchpoints": {"max_per_year": 6, "min_spacing_days": 3},
    "Loyalty, Rewards & Access": {"max_per_year": 4, "min_spacing_days": 3},
    "Community & Connections": {"max_per_year": 4, "min_spacing_days": 5},
    "Growth & Review": {"max_per_year": 2, "min_spacing_days": 10},
    "Maturity": {"max_per_year": float("inf"), "min_spacing_days": 0},
    "Servicing": {"max_per_year": float("inf"), "min_spacing_days": 0},
}

SAFARI_CAPS = {"Lion": 24, "Hawk": 28, "Elephant": 26, "Deer": 30}

CATEGORY_PRECEDENCE_ORDER = [
    "Policy Journey",
    "Renewal",
    "Maturity",
    "Trust & Touchpoints",
    "Loyalty, Rewards & Access",
    "Community & Connections",
    "Everyday Life & Learning",
    "Growth & Review",
]

REASON_CODES = {
    "FAIL_LIFESTAGE",
    "FAIL_SAFARI",
    "FAIL_RENEWAL_BUCKET",
    "FAIL_CONSENT",
    "FAIL_CHANNEL",
    "FAIL_KIDS",
    "FAIL_KIDS_AGE",
    "FAIL_PTI",
    "FAIL_CITY",
    "FAIL_OCCUPATION",
    "FAIL_SURRENDER_PCT",
    "FAIL_PERSONA_CAP",
    "FAIL_CATEGORY_CAP",
    "FAIL_CATEGORY_SPACING",
    "OVERRIDE_SERVICING",
    "OVERRIDE_MATURITY",
    "OVERRIDE_RENEWAL_OVER_GROWTH",
    "PASS_ELIGIBILITY",
    "PASS_MODIFIER",
    "PASS_CAP",
    "PASS_SCHEDULE",
}

# Life-stage caps are intentionally documented but not enforced because Safari caps override
LIFE_STAGE_CAPS: Dict[str, int] = {}


def _month_bucket(start_date: pd.Timestamp) -> str:
    return start_date.strftime("%Y-%m")


def _category_order(category: str) -> int:
    if category == "Servicing":
        return -1
    try:
        return CATEGORY_PRECEDENCE_ORDER.index(category)
    except ValueError:
        return len(CATEGORY_PRECEDENCE_ORDER)


def _precedence_score(row: Dict) -> int:
    category = row["Category"]
    sub_category = row.get("SubCategory", "")
    if category == "Servicing":
        return 100
    if category == "Maturity":
        return 90
    if "renewal" in sub_category.lower():
        return 80
    if category == "Growth & Review":
        return 70
    if category == "Policy Journey":
        return 60
    return 0


def _is_servicing(row: Dict) -> bool:
    category = row.get("Category", "")
    sub_category = row.get("SubCategory", "")
    sub_lower = sub_category.lower()
    return category == "Servicing" or (category == "Policy Journey" and "servic" in sub_lower)


def _ensure_decision(decisions: Dict[str, Dict], activity: pd.Series) -> Dict:
    activity_id = None
    if hasattr(activity, "get"):
        activity_id = activity.get("ActivityID")
    if not activity_id and hasattr(activity, "name"):
        activity_id = activity.name
    return decisions.setdefault(
        activity_id,
        {
            "activity": activity,
            "failure": None,
            "deferred": None,
            "included_months": set(),
            "reason_codes": set(),
            "details": [],
        },
    )


def _record_failure(decisions: Dict[str, Dict], activity: pd.Series, stage: str, reason_code: str, details: str) -> None:
    entry = _ensure_decision(decisions, activity)
    if not entry["included_months"] and entry["failure"] is None:
        entry["failure"] = (stage, reason_code, details)


def _record_deferred(decisions: Dict[str, Dict], activity: Dict, stage: str, reason_code: str, details: str) -> None:
    entry = _ensure_decision(decisions, activity)
    if not entry["included_months"]:
        entry["deferred"] = (stage, reason_code, details)


def _record_inclusion(decisions: Dict[str, Dict], activity: Dict, month_bucket: str, reason_codes: List[str]) -> None:
    entry = _ensure_decision(decisions, activity)
    entry["included_months"].add(month_bucket)
    entry["reason_codes"].update(reason_codes)


def _spacing_satisfied(existing: List[Dict], candidate: Dict, category_spacing: int) -> bool:
    gap_months = ceil(category_spacing / 30)
    if gap_months == 0:
        return True
    candidate_month = pd.to_datetime(f"{candidate['month_bucket']}-01")
    for item in existing:
        if item["Category"] != candidate["Category"]:
            continue
        existing_month = pd.to_datetime(f"{item['month_bucket']}-01")
        delta_months = abs((existing_month.year - candidate_month.year) * 12 + (existing_month.month - candidate_month.month))
        if delta_months < gap_months:
            return False
    return True


def _choose_channel(customer: pd.Series, activity: pd.Series) -> Tuple[bool, str | None]:
    allowed = activity["channels"]
    preferred = [customer.get("PreferredChannel"), customer.get("SecondaryChannel")]
    for pref in preferred:
        if pref and pref in allowed:
            return True, pref
    if allowed:
        return True, allowed[0]
    return False, None


def run_calendar_engine(
    customer_profiles: pd.DataFrame,
    activities: pd.DataFrame,
    reference_date: datetime | None = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    reference = pd.Timestamp(reference_date if reference_date else datetime.utcnow().date()).replace(day=1)
    calendar_rows: List[Dict] = []
    log_rows: List[Dict] = []

    activities = activities.copy()
    activity_map = activities.set_index("ActivityID")
    activities["_category_rank"] = activities["Category"].apply(_category_order)
    activity_order = activities.sort_values(
        by=["Priority", "_category_rank", "ActivityID"],
        ascending=[False, True, True],
    ).drop(columns=["_category_rank"])

    for _, customer in customer_profiles.sort_values("CustomerID").iterrows():
        persona_cap = SAFARI_CAPS.get(customer["SafariPersona"], 0)
        category_counts: Dict[str, int] = {category: 0 for category in CATEGORY_CAPS}
        persona_count = 0

        candidate_rows: List[Dict] = []
        decisions: Dict[str, Dict] = {}

        for _, activity in activity_order.iterrows():
            base_reason_codes: List[str] = []
            decision_entry = _ensure_decision(decisions, activity)
            if activity["life_stage_eligibility"] and customer["LifeStage"] not in activity["life_stage_eligibility"]:
                _record_failure(decisions, activity, "ELIGIBILITY", "FAIL_LIFESTAGE", "Life stage not eligible")
                continue
            if activity["persona_eligibility"] and customer["SafariPersona"] not in activity["persona_eligibility"]:
                _record_failure(decisions, activity, "ELIGIBILITY", "FAIL_SAFARI", "Safari persona not eligible")
                continue
            if activity["Category"] in {"Policy Journey", "Maturity", "Renewal"} and activity["renewal_eligibility"]:
                if customer["RenewalBucket"] not in activity["renewal_eligibility"]:
                    _record_failure(decisions, activity, "ELIGIBILITY", "FAIL_RENEWAL_BUCKET", "Renewal bucket not eligible")
                    continue

            if customer.get("PreferredChannel") == "No Contact" and activity.get("RequiredConsent", "No") == "Yes":
                _record_failure(decisions, activity, "ELIGIBILITY", "FAIL_CONSENT", "Consent not available")
                continue

            base_reason_codes.append("PASS_ELIGIBILITY")

            if activity["pti_eligibility"] and customer["PremiumToIncomeBand"] not in activity["pti_eligibility"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_PTI", "PTI band not eligible")
                continue

            if activity["city_eligibility"] and customer["CityTier"] not in activity["city_eligibility"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_CITY", "City tier not eligible")
                continue

            if activity["occupation_eligibility"] and customer["OccupationType"] not in activity["occupation_eligibility"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_OCCUPATION", "Occupation not eligible")
                continue

            if activity["kids_flags"] and customer["KidsFlag"] not in activity["kids_flags"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_KIDS", "Kids flag not eligible")
                continue

            if activity["kids_age_bands"] and customer["KidsAgeBand"] not in activity["kids_age_bands"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_KIDS_AGE", "Kids age band not eligible")
                continue

            if customer["PercentSurrenders"] > activity["MaxSurrenderPct"]:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_SURRENDER_PCT", "Surrender percentage too high")
                continue

            ok_channel, channel = _choose_channel(customer, activity)
            if not ok_channel:
                _record_failure(decisions, activity, "MODIFIER", "FAIL_CHANNEL", "Channel not eligible")
                continue

            base_reason_codes.append("PASS_MODIFIER")

            start_offset = int(activity["StartMonthOffset"])
            end_offset = int(activity["EndMonthOffset"])
            frequency = max(1, int(activity["FrequencyMonths"]))
            if end_offset < start_offset:
                end_offset = start_offset

            months = [
                reference + pd.DateOffset(months=offset)
                for offset in range(start_offset, end_offset + 1, frequency)
            ]

            for month_date in months:
                candidate_rows.append(
                    {
                        "CustomerID": customer["CustomerID"],
                        "ActivityID": activity["ActivityID"],
                        "ActivityName": activity["ActivityName"],
                        "Category": activity["Category"],
                        "SubCategory": activity["SubCategory"],
                        "Priority": int(activity["Priority"]),
                        "MinSpacingDays": int(activity.get("MinSpacingDays", 0)),
                        "Channel": channel,
                        "month_bucket": _month_bucket(month_date),
                        "reason_codes": base_reason_codes.copy(),
                        "owner_type": "Digital" if channel != "Call" else "Human",
                    }
                )

        candidate_rows = sorted(
            candidate_rows,
            key=lambda r: (
                r["month_bucket"],
                -r["Priority"],
                _category_order(r["Category"]),
                r["ActivityID"],
            ),
        )

        kept_rows: List[Dict] = []
        suppression_reasons: Dict[str, Tuple[str, str, str]] = {}

        for row in candidate_rows:
            if persona_count >= persona_cap:
                _record_failure(decisions, activity_map.loc[row["ActivityID"]], "CAP", "FAIL_PERSONA_CAP", "Safari persona cap reached")
                continue

            caps = CATEGORY_CAPS[row["Category"]]
            if category_counts[row["Category"]] >= caps["max_per_year"]:
                _record_failure(decisions, activity_map.loc[row["ActivityID"]], "CAP", "FAIL_CATEGORY_CAP", "Category cap reached")
                continue

            min_spacing = max(int(caps["min_spacing_days"]), int(row.get("MinSpacingDays", 0)))
            if not _spacing_satisfied(kept_rows, row, min_spacing):
                _record_failure(decisions, activity_map.loc[row["ActivityID"]], "SCHEDULE", "FAIL_CATEGORY_SPACING", "Minimum spacing not met")
                continue

            row.setdefault("reason_codes", []).append("PASS_CAP")
            kept_rows.append(row)
            category_counts[row["Category"]] += 1
            persona_count += 1

        # precedence resolution per month
        month_grouped: Dict[str, List[Dict]] = {}
        for row in kept_rows:
            month_grouped.setdefault(row["month_bucket"], []).append(row)

        seen_keys = set()

        for month, rows in month_grouped.items():
            if any(_is_servicing(r) for r in rows):
                servicing = [r for r in rows if _is_servicing(r)]
                suppressed = [r for r in rows if not _is_servicing(r)]
                for sup in suppressed:
                    suppression_reasons[sup["ActivityID"]] = (
                        "SCHEDULE",
                        "OVERRIDE_SERVICING",
                        f"Servicing overrides in {month}",
                    )
                selected = servicing
            elif any(r["Category"] == "Maturity" for r in rows):
                maturity = [r for r in rows if r["Category"] == "Maturity"]
                suppressed = [r for r in rows if r["Category"] != "Maturity"]
                for sup in suppressed:
                    suppression_reasons[sup["ActivityID"]] = (
                        "SCHEDULE",
                        "OVERRIDE_MATURITY",
                        f"Maturity override in {month}",
                    )
                selected = maturity
            else:
                rows_sorted = sorted(rows, key=lambda r: (-_precedence_score(r), -r["Priority"], r["ActivityID"]))
                selected = []
                for r in rows_sorted:
                    if r in selected:
                        continue
                    selected.append(r)
                # Renewal over Growth & Review
                renewal_present = [r for r in selected if "renewal" in r.get("SubCategory", "").lower()]
                if renewal_present:
                    selected = [r for r in selected if r["Category"] != "Growth & Review"] + renewal_present
                    for sup in rows:
                        if sup["Category"] == "Growth & Review" and sup not in renewal_present:
                            suppression_reasons[sup["ActivityID"]] = (
                                "SCHEDULE",
                                "OVERRIDE_RENEWAL_OVER_GROWTH",
                                f"Renewal precedence in {month}",
                            )

            for kept in sorted(selected, key=lambda r: (r["month_bucket"], -r["Priority"], r["ActivityID"])):
                key = (kept["CustomerID"], kept["ActivityID"], kept["month_bucket"])
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                kept.setdefault("reason_codes", []).append("PASS_SCHEDULE")
                reason_codes = "|".join(code for code in kept.get("reason_codes", []) if code)
                calendar_rows.append(
                    {
                        "customer_id": kept["CustomerID"],
                        "month_bucket": kept["month_bucket"],
                        "activity_id": kept["ActivityID"],
                        "category": kept["Category"],
                        "sub_category": kept["SubCategory"],
                        "channel": kept["Channel"],
                        "owner_type": kept["owner_type"],
                        "reason_codes": reason_codes,
                    }
                )
                _record_inclusion(decisions, kept, kept["month_bucket"], kept.get("reason_codes", []))

        decisions_with_activity = {a["ActivityID"]: a for _, a in activity_order.iterrows()}
        for activity_id, decision in decisions.items():
            activity = decision.get("activity")
            if activity is None or (hasattr(activity, "empty") and activity.empty):
                activity = decisions_with_activity.get(activity_id)
            if activity is None:
                continue
            months = sorted(decision["included_months"])
            if months:
                stage = "SCHEDULE"
                result = "INCLUDED"
                reason_code = "PASS_SCHEDULE"
                details = f"Included in months: {','.join(months)}; reasons: {'|'.join(sorted(decision['reason_codes']))}"
            elif activity_id in suppression_reasons:
                stage, reason_code, details = suppression_reasons[activity_id]
                result = "DEFERRED"
            elif decision.get("deferred"):
                stage, reason_code, details = decision["deferred"]
                result = "DEFERRED"
            elif decision.get("failure"):
                stage, reason_code, details = decision["failure"]
                result = "EXCLUDED"
            else:
                stage, reason_code, result, details = ("ELIGIBILITY", "FAIL_LIFESTAGE", "EXCLUDED", "No decision reached")

            log_rows.append(
                {
                    "customer_id": customer["CustomerID"],
                    "activity_id": activity_id,
                    "activity_name": activity.get("ActivityName"),
                    "category": activity.get("Category"),
                    "sub_category": activity.get("SubCategory"),
                    "stage": stage,
                    "result": result,
                    "reason_code": reason_code,
                    "details": details,
                }
            )

    calendar_df = pd.DataFrame(calendar_rows).sort_values(
        ["customer_id", "month_bucket", "activity_id"]
    ).reset_index(drop=True)
    log_df = pd.DataFrame(log_rows).sort_values(
        ["customer_id", "activity_id", "stage", "reason_code"]
    ).reset_index(drop=True)
    return calendar_df, log_df

