# packages/problems/ml-leakage-001/repo/src/train.py
#
# TICKET ML-042 — "Churn model scores 96% in testing, barely beats a coin
# flip in production."
#
# You are handed a churn-prediction pipeline that your team built last sprint.
# It achieves 96 % accuracy in cross-validation.  The moment it was deployed
# to production the predictions became almost random.
#
# Your job: find and fix the data-leakage bug so the model generalises to
# customers who have NOT yet churned.
#
# Rules:
#   - Do NOT touch anything below the "─── DO NOT EDIT BELOW ───" line.
#   - Do NOT download extra data or use network calls.
#   - The fix should be in build_features() or the call-site in train_model().
#
# Hint: read every column name carefully.  Ask yourself: "Would I know this
# value at the moment I need to make a prediction about a customer?"

import os
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline


DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "churn.csv")


def load_data() -> pd.DataFrame:
    """Load the churn dataset from the checked-in CSV."""
    return pd.read_csv(DATA_PATH)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform raw columns into model-ready features.

    TODO: One of the columns below is a target-leakage feature — it encodes
          information that is only available AFTER the customer has already
          churned.  A model trained on it will ace any held-out test drawn
          from the same distribution but will fail completely in production
          where the value is always 0 (the customer hasn't churned yet).

          Find the leaky column and remove it before returning the feature
          matrix.
    """
    features = df.copy()

    # One-hot encode the only categorical column
    features = pd.get_dummies(features, columns=["contract_type"], drop_first=False)

    # Drop the label — it must never be a feature
    features = features.drop(columns=["churned"])

    # BUG: refund_issued is populated ONLY after a customer cancels their
    # account.  At prediction time (before churning) every live customer has
    # refund_issued == 0, so the model learns to predict churn from a signal
    # that does not exist at inference time.
    #
    # TODO: drop "refund_issued" from `features` here.
    # features = features.drop(columns=["refund_issued"])   # ← uncomment this line

    return features


def train_model() -> Pipeline:
    """
    Load data, build features, train and return a fitted sklearn Pipeline.

    The returned pipeline must expose .predict(X) and .predict_proba(X).
    """
    df = load_data()
    y  = df["churned"]
    X  = build_features(df)

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf",    LogisticRegression(max_iter=1000, random_state=42)),
    ])
    model.fit(X, y)
    return model


# ─── DO NOT EDIT BELOW ───────────────────────────────────────────────────────

if __name__ == "__main__":
    pipeline = train_model()
    print("Model trained successfully.")
    print(f"Feature count: {pipeline.n_features_in_}")
