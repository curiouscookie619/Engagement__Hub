"""Placeholder for Stage 2 effort engine."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any

import pandas as pd


@dataclass
class EffortEngineInput:
    customer_profiles: pd.DataFrame
    calendar: pd.DataFrame
    activities: pd.DataFrame


class EffortEngine:
    """Stub interface to capture required inputs for future scoring."""

    def __init__(self) -> None:
        self.last_inputs: EffortEngineInput | None = None

    def prepare_inputs(
        self, customer_profiles: pd.DataFrame, calendar: pd.DataFrame, activities: pd.DataFrame
    ) -> EffortEngineInput:
        self.last_inputs = EffortEngineInput(customer_profiles.copy(), calendar.copy(), activities.copy())
        return self.last_inputs

    def score(self) -> pd.DataFrame:
        if self.last_inputs is None:
            raise ValueError("No inputs prepared for the effort engine.")
        # Placeholder: return empty DataFrame until scoring rules are defined.
        return pd.DataFrame()
