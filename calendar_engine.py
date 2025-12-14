"""Weekly engagement calendarisation engine with variety enforcement."""
from __future__ import annotations

from datetime import datetime, timedelta
from math import ceil
from typing import Dict, List, Tuple

import pandas as pd

VARIETY_RECENT_WINDOW_WEEKS = 8
VARIETY_SOFT_PENALTY = 1000
PLANNING_WEEKS = 12

CATEGORY_CAPS = {
    "Everyday Life & Learning": {"max_per_year": 8, "cooldown_weeks": 1},
    "Policy Journey": {"max_per_year": 8, "cooldown_weeks": 1},
    "Trust & Touchpoints": {"max_per_year": 6, "cooldown_weeks": 1},
    "Loyalty, Rewards & Access": {"max_per_year": 4, "cooldown_weeks": 1},
    "Community & Connections": {"max_per_year": 4, "cooldown_weeks": 1},
    "Growth & Review": {"max_per_year": 2, "cooldown_weeks": 2},
    "Maturity": {"max_per_year": float("inf"), "cooldown_weeks": 1},
    "Servicing": {"max_per_year": float("inf"), "cooldown_weeks": 1},
}

CATEGORY_PRECEDENCE_BONUS = {
    "Servicing": 500,
    "Policy Journey": 400,
    "Maturity": 350,
    "Trust & Touchpoints": 300,
    "Loyalty, Rewards & Access": 250,
    "Community & Connections": 200,
    "Everyday Life & Learning": 150,
    "Growth & Review": 100,
}

SAFARI_CAPS = {"Lion": 24, "Hawk": 28, "Elephant": 26, "Deer": 30}

REASON_CODES = {
    "FAIL_LIFESTAGE",
    "FAIL_SAFARI",
    "FAIL_RENEWAL_BUCKET",
    "FAIL_PTI",
    "FAIL_CITY",
    "FAIL_OCCUPATION",
    "FAIL_KIDS",
    "FAIL_KIDS_AGE",
    "FAIL_SURRENDER_PCT",
    "FAIL_CATEGORY_CAP",
    "FAIL_PERSONA_CAP",
    "FAIL_CATEGORY_SPACING",
    "FAIL_GAP_SAME_ACTIVITY",
    "FAIL_GAP_SAME_THEME",
    "FAIL_VARIETY_KEY_MONTH_HARD",
    "WARN_VARIETY_KEY_RECENT_SOFT",
    "PASS_ELIGIBILITY",
    "PASS_MODIFIER",
    "PASS_CAP",
    "PASS_SCHEDULE",
}


def _week_start(ts: pd.Timestamp) -> pd.Timestamp:
    return ts - pd.Timedelta(days=ts.weekday())


def _month_bucket_from_week(week_start: pd.Timestamp) -> str:
    return week_start.strftime("%Y-%m")


def _week_bucket(week_start: pd.Timestamp) -> str:
    iso = week_start.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _record_failure(decisions: Dict[str, Dict], activity_id: str, stage: str, reason: str, details: str) -> None:
    entry = decisions.setdefault(activity_id, {"included": [], "reasons": set(), "failure": None})
    if entry["failure"] is None:
        entry["failure"] = (stage, reason, details)


def _record_inclusion(decisions: Dict[str, Dict], activity_id: str, week_bucket: str, reason_codes: List[str]) -> None:
    entry = decisions.setdefault(activity_id, {"included": [], "reasons": set(), "failure": None})
    entry["included"].append(week_bucket)
    entry["reasons"].update(reason_codes)


def _owner_for_channel(channel: str, requires_human: bool) -> str:
    if channel is None:
        return "Digital"
    if "Telecalling" in channel or channel == "SMS":
        return "CallCentre"
    if "RMVisit" in channel:
        return "RM"
    if channel == "Branch":
        return "BranchOps"
    if requires_human:
        return "Field"
    return "Digital"


def run_calendar_engine(
    customer_profiles: pd.DataFrame,
    activities: pd.DataFrame,
    reference_date: datetime | None = None,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    reference = pd.Timestamp(reference_date if reference_date else datetime.utcnow().date())
    start_week = _week_start(reference)

    calendar_rows: List[Dict] = []
    log_rows: List[Dict] = []

    # sort activities deterministically
    activities = activities.sort_values(["Priority", "ActivityID"], ascending=[False, True]).reset_index(drop=True)

    for _, customer in customer_profiles.sort_values("CustomerID").iterrows():
        persona_cap = SAFARI_CAPS.get(customer.get("SafariPersona"), 0)
        persona_count = 0
        category_counts: Dict[str, int] = {cat: 0 for cat in CATEGORY_CAPS}
        last_category_week: Dict[str, int] = {}
        last_activity_week: Dict[str, int] = {}
        last_theme_week: Dict[str, int] = {}
        variety_month_seen: Dict[Tuple[str, str], bool] = {}
        variety_recent_week: Dict[str, int] = {}

        decisions: Dict[str, Dict] = {}

        # Eligibility pass list
        eligible = []
        for _, activity in activities.iterrows():
            aid = activity["ActivityID"]
            reasons = ["PASS_ELIGIBILITY"]

            if activity["life_stage_eligibility"] and customer["LifeStage"] not in activity["life_stage_eligibility"]:
                _record_failure(decisions, aid, "ELIGIBILITY", "FAIL_LIFESTAGE", "Life stage not eligible")
                continue
            if activity["persona_eligibility"] and customer["SafariPersona"] not in activity["persona_eligibility"]:
                _record_failure(decisions, aid, "ELIGIBILITY", "FAIL_SAFARI", "Safari persona not eligible")
                continue
            if activity["renewal_eligibility"] and customer["RenewalBucket"] not in activity["renewal_eligibility"]:
                _record_failure(decisions, aid, "ELIGIBILITY", "FAIL_RENEWAL_BUCKET", "Renewal bucket not eligible")
                continue

            # modifiers
            if activity["kids_flags"]:
                if customer.get("KidsFlag") not in activity["kids_flags"]:
                    _record_failure(decisions, aid, "MODIFIER", "FAIL_KIDS", "Kids flag not eligible")
                    continue
            if activity["kids_age_bands"]:
                if customer.get("KidsAgeBand") not in activity["kids_age_bands"]:
                    _record_failure(decisions, aid, "MODIFIER", "FAIL_KIDS_AGE", "Kids age band not eligible")
                    continue
            if activity["pti_eligibility"] and customer.get("PremiumToIncomeBand") not in activity["pti_eligibility"]:
                _record_failure(decisions, aid, "MODIFIER", "FAIL_PTI", "PTI band not eligible")
                continue
            if activity["city_eligibility"] and customer.get("CityTier") not in activity["city_eligibility"]:
                _record_failure(decisions, aid, "MODIFIER", "FAIL_CITY", "City not eligible")
                continue
            if activity["occupation_eligibility"] and customer.get("OccupationType") not in activity["occupation_eligibility"]:
                _record_failure(decisions, aid, "MODIFIER", "FAIL_OCCUPATION", "Occupation not eligible")
                continue
            if _bool_from_flag(activity.get("exclude_if_high_surrender_pct")) and customer.get("PercentSurrenders", 0) > 0:
                _record_failure(decisions, aid, "MODIFIER", "FAIL_SURRENDER_PCT", "High surrender percent")
                continue

            reasons.append("PASS_MODIFIER")
            eligible.append((activity, reasons))

        # weekly scheduling
        for week_idx in range(PLANNING_WEEKS):
            week_start = start_week + pd.Timedelta(weeks=week_idx)
            week_bucket = _week_bucket(week_start)
            month_bucket = _month_bucket_from_week(week_start)

            candidates: List[Tuple[Dict, float, bool]] = []  # (row, score, soft_penalty_applied)

            for activity, base_reasons in eligible:
                aid = activity["ActivityID"]
                category = activity["Category"]

                if persona_count >= persona_cap:
                    _record_failure(decisions, aid, "CAP", "FAIL_PERSONA_CAP", "Safari persona cap reached")
                    continue
                cat_cap = CATEGORY_CAPS.get(category, {"max_per_year": 0, "cooldown_weeks": 0})
                if category_counts.get(category, 0) >= cat_cap["max_per_year"]:
                    _record_failure(decisions, aid, "CAP", "FAIL_CATEGORY_CAP", "Category cap reached")
                    continue

                # category cooldown
                last_cat = last_category_week.get(category)
                if last_cat is not None and week_idx - last_cat <= cat_cap["cooldown_weeks"] - 1:
                    _record_failure(decisions, aid, "SCHEDULE", "FAIL_CATEGORY_SPACING", "Category cooldown active")
                    continue

                # gap rules
                min_gap_act = int(activity.get("min_gap_activity_weeks", 0))
                if aid in last_activity_week and week_idx - last_activity_week[aid] <= min_gap_act - 1:
                    _record_failure(decisions, aid, "SCHEDULE", "FAIL_GAP_SAME_ACTIVITY", "Activity gap not met")
                    continue

                min_gap_theme = int(activity.get("min_gap_theme_weeks", 0))
                theme_key = activity.get("Theme", "")
                if theme_key in last_theme_week and week_idx - last_theme_week[theme_key] <= min_gap_theme - 1:
                    _record_failure(decisions, aid, "SCHEDULE", "FAIL_GAP_SAME_THEME", "Theme gap not met")
                    continue

                # hard variety
                vkey = activity.get("VarietyKey", "")
                if vkey:
                    if variety_month_seen.get((vkey, month_bucket)):
                        _record_failure(
                            decisions,
                            aid,
                            "SCHEDULE",
                            "FAIL_VARIETY_KEY_MONTH_HARD",
                            f"Variety key already used in {month_bucket}",
                        )
                        continue

                soft_penalty = False
                if vkey and activity.get("repeat_penalty_mode", "HARD") == "SOFT":
                    last_week_for_key = variety_recent_week.get(vkey)
                    if last_week_for_key is not None and week_idx - last_week_for_key <= VARIETY_RECENT_WINDOW_WEEKS:
                        soft_penalty = True

                score = activity["Priority"] * 100 + CATEGORY_PRECEDENCE_BONUS.get(category, 0)
                if soft_penalty:
                    score -= VARIETY_SOFT_PENALTY

                candidates.append((activity, score, soft_penalty))

            if not candidates:
                continue

            # select best
            candidates.sort(
                key=lambda x: (
                    -x[1],
                    -x[0]["Priority"],
                    -CATEGORY_PRECEDENCE_BONUS.get(x[0]["Category"], 0),
                    x[0]["ActivityID"],
                )
            )
            chosen, _, applied_soft = candidates[0]
            aid = chosen["ActivityID"]
            category = chosen["Category"]
            vkey = chosen.get("VarietyKey", "")

            channel = chosen["PreferredChannel"] if chosen["PreferredChannel"] in chosen["channels"] else chosen["channels"][0]
            owner = _owner_for_channel(channel, bool(chosen.get("requires_human")))

            reason_codes = ["PASS_CAP", "PASS_SCHEDULE"]
            if applied_soft:
                reason_codes.append("WARN_VARIETY_KEY_RECENT_SOFT")

            # update trackers
            persona_count += 1
            category_counts[category] = category_counts.get(category, 0) + 1
            last_category_week[category] = week_idx
            last_activity_week[aid] = week_idx
            last_theme_week[chosen.get("Theme", "")] = week_idx
            if vkey:
                variety_month_seen[(vkey, month_bucket)] = True
                variety_recent_week[vkey] = week_idx

            week_bucket_label = week_bucket

            calendar_rows.append(
                {
                    "customer_id": customer["CustomerID"],
                    "week_bucket": week_bucket_label,
                    "month_bucket": month_bucket,
                    "activity_id": aid,
                    "category": category,
                    "sub_category": chosen.get("SubCategory"),
                    "channel": channel,
                    "owner_type": owner,
                    "reason_codes": "|".join(reason_codes),
                }
            )

            _record_inclusion(decisions, aid, week_bucket_label, reason_codes)

        # finalise decision log entries per activity
        for _, activity in activities.iterrows():
            aid = activity["ActivityID"]
            entry = decisions.get(aid, {"included": [], "reasons": set(), "failure": None})
            if entry["included"]:
                stage = "SCHEDULE"
                result = "INCLUDED"
                reason_code = "PASS_SCHEDULE"
                details = f"weeks={','.join(entry['included'])}; reasons={'|'.join(sorted(entry['reasons']))}"
            elif entry.get("failure"):
                stage, reason_code, details = entry["failure"]
                result = "EXCLUDED"
            else:
                stage, reason_code, result, details = ("SCHEDULE", "FAIL_CATEGORY_CAP", "EXCLUDED", "Not scheduled")

            log_rows.append(
                {
                    "customer_id": customer["CustomerID"],
                    "activity_id": aid,
                    "activity_name": activity.get("ActivityName"),
                    "category": activity.get("Category"),
                    "sub_category": activity.get("SubCategory"),
                    "stage": stage,
                    "result": result,
                    "reason_code": reason_code,
                    "details": details,
                }
            )

    calendar_df = pd.DataFrame(calendar_rows).sort_values([
        "customer_id",
        "week_bucket",
        "activity_id",
    ]).reset_index(drop=True)
    log_df = pd.DataFrame(log_rows).sort_values([
        "customer_id",
        "activity_id",
        "stage",
        "reason_code",
    ]).reset_index(drop=True)
    return calendar_df, log_df


def _bool_from_flag(value) -> bool:
    return str(value).strip().upper() == "TRUE"
