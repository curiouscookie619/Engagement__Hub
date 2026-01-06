from datetime import datetime
from pathlib import Path

from datetime import datetime

import streamlit as st

from pathlib import Path

from ingest import load_pragati, load_d365, load_activity_library, ValidationError
from derive import build_customer_profile, profile_columns
from activity_library import normalise_activity_library
from calendar_engine import run_calendar_engine
from export import export_outputs
from stage2_effort import EffortEngine

st.set_page_config(page_title="Engagement Calendarisation Engine", layout="wide")
st.title("Engagement Calendarisation Engine")


def load_sample_data():
    pragati = load_pragati("data/sample/pragati.csv")
    d365 = load_d365("data/sample/d365.csv")
    activity = load_activity_library("data/sample/activity_library.csv")
    return pragati, d365, activity


def parse_upload(label: str, loader, key: str):
    uploaded = st.file_uploader(label, type="csv", key=key)
    if uploaded is None:
        return None
    try:
        return loader(uploaded)
    except ValidationError as exc:
        st.error(f"{label} error: {exc}")
        return None


st.sidebar.header("Input data")
use_sample = st.sidebar.checkbox("Use sample data", value=True)

if use_sample:
    pragati_df, d365_df, activity_df = load_sample_data()
else:
    pragati_df = parse_upload("Pragati CSV", load_pragati, "pragati")
    d365_df = parse_upload("D365 CSV", load_d365, "d365")
    activity_df = parse_upload("Activity library CSV", load_activity_library, "activity")

ready = pragati_df is not None and d365_df is not None and activity_df is not None

if ready:
    st.subheader("Raw inputs")
    st.dataframe(pragati_df)
    st.dataframe(d365_df)
    st.dataframe(activity_df)

    reference_date = st.date_input("As-of date", value=datetime.utcnow().date())

    try:
        profile_df = build_customer_profile(pragati_df, d365_df, as_of_date=reference_date)
        library_df = normalise_activity_library(activity_df)
    except ValidationError as exc:
        st.error(f"Validation failed: {exc}")
        st.stop()

    st.subheader("Customer profile (derived layer)")
    st.dataframe(profile_df[list(profile_columns())])

    calendar_df, log_df = run_calendar_engine(profile_df, library_df, reference_date=reference_date)

    st.subheader("Engagement calendar")
    st.dataframe(calendar_df)

    st.subheader("Decision log")
    st.dataframe(log_df)

    effort_engine = EffortEngine()
    effort_engine.prepare_inputs(profile_df, calendar_df, library_df)

    output_dir = st.text_input("Export directory", value=str(Path("outputs")))
    if st.button("Export calendar & decision log"):
        calendar_csv, calendar_json, decision_csv, decision_json, derived_csv, derived_json = export_outputs(
            calendar_df, log_df, profile_df[profile_columns()], output_dir
        )
        st.success("Export complete")
        st.write(calendar_csv)
        st.write(calendar_json)
        st.write(decision_csv)
        st.write(decision_json)
        st.write(derived_csv)
        st.write(derived_json)
else:
    st.info("Upload required inputs or enable sample data to proceed.")
