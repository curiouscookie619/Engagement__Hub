# Engagement Calendarisation Engine

Deterministic, fully-auditable engagement orchestration for Pragati + D365 extracts. The Streamlit app ingests raw CSVs, derives an authoritative Customer Profile layer, loads an Activity Library, runs the Stage 1 calendarisation engine, and exports both an engagement calendar and decision log. A Stage 2 Effort Engine placeholder stores required inputs for future scoring without altering the calendar.

## Repository layout
- `ingest.py` – CSV loading and strong validation for Pragati, D365, and the activity library (dates, enums, numerics).
- `derive.py` – Builds the Customer Profile derived layer (PTI bands, vintage, city tier, kids, surrender %, portfolio composition, safari persona, renewal bucket).
- `activity_library.py` – Normalises multi-value activity fields (pipe-separated) into lists.
- `calendar_engine.py` – Deterministic Stage 1 engine with eligibility layers, caps, spacing, precedence, channel assignment, and exhaustive decision logging.
- `stage2_effort.py` – Placeholder interface capturing inputs for the later Effort Engine.
- `export.py` – CSV/JSON export helpers for calendar, decision log, and derived profile outputs with timestamped filenames.
- `app.py` – Streamlit UI orchestrating ingestion → derivation → library normalisation → calendarisation → export.
- `data/sample/` – Example CSVs matching the enforced schemas.

## Determinism
- Customers are processed in sorted `CustomerID` order; activities in `Priority` then `ActivityID` order.
- Scheduling uses a fixed reference month (first day of input reference date) and deterministic channel pick (preferred > secondary > alphabetical fallback for `Any`).
- Spacing uses category minimums; precedence resolves monthly conflicts with Servicing > Maturity > Renewal > Growth & Review.

## Running locally
```bash
pip install -r requirements.txt
streamlit run app.py
```
Use the provided sample files or upload your own extracts and activity library.

## Outputs
- `engagement_calendar_*.csv/json`: customer_id, month_bucket, activity_id, category/sub_category, channel, owner_type, reason_codes.
- `decision_log_*.csv/json`: stage, result, reason_code, and details for every customer×activity across eligibility, modifiers, caps, and scheduling.
- `derived_profile_*.csv/json`: Derived customer attributes for auditability.
- `data/output/*_sample.csv`: static compliance proofs for calendar, decision log, and derived profiles built from the provided sample data.

## Compliance helpers
- `traceability.md` maps each rule to code and automated checks.
- `tests/` contains pytest coverage for derivations, caps, spacing, and precedence.
- `run_sample.py` executes the full pipeline on sample CSVs and asserts caps/spacing/precedence before writing outputs to `data/output/`.

## Notes
- Only rule-based, no probabilistic ranking. Caps and spacing follow the authoritative category and Safari persona limits. Servicing and Maturity precedence are enforced without changing calendar structure.
