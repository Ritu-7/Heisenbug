# packages/problems/ml-leakage-001/bad_patches/log_transform_leaky.py
#
# BAD PATCH: "Fix" the leakage concern by log-transforming refund_issued
# instead of dropping it.
#
# Why it passes visible tests:
#   V1 — model trains without error ✓
#   V2 — predict_proba is well-formed ✓
#   V3 — held-out accuracy on in-distribution data is still high ✓
#         (the leaky signal is still present, just rescaled)
#
# Why it fails hidden tests:
#   H1 — production simulation zeros out refund_issued for all test rows.
#         log(0 + 1) = 0, so the feature IS zero — but the model was trained
#         with refund_issued≈1 for churners (log(1+1)=0.693), so it still
#         has a large coefficient for this column and its predictions collapse
#         when the column is universally 0 at inference time.
#         → accuracy drops well below 0.60 threshold.
#
#   H2 — refund_issued is still in the feature set with a large |coefficient|.
#         The log transform doesn't reduce the model's reliance on the column.
#         → |coefficient| >> 0.10.
#
# Root cause: the information leak is the COLUMN ITSELF, not its scale.
# Rescaling a post-churn signal preserves the leak in a different numeric form.

import os
import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline


DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "churn.csv")


def load_data() -> pd.DataFrame:
    return pd.read_csv(DATA_PATH)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    BAD: log-transforms refund_issued instead of dropping it.
    The information leak is still fully present.
    """
    features = df.copy()

    # "Fix" the leaky column by scaling it (does NOT fix the leak)
    features["refund_issued"] = np.log1p(features["refund_issued"])

    features = pd.get_dummies(features, columns=["contract_type"], drop_first=False)
    features = features.drop(columns=["churned"])

    return features


def train_model() -> Pipeline:
    df = load_data()
    y  = df["churned"]
    X  = build_features(df)

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf",    LogisticRegression(max_iter=1000, random_state=42)),
    ])
    model.fit(X, y)
    return model


if __name__ == "__main__":
    pipeline = train_model()
    print("Bad-patch model trained successfully.")
    print(f"Feature count: {pipeline.n_features_in_}")
