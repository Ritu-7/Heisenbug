# packages/problems/ml-leakage-001/solutions/reference.py
#
# Reference solution: drop the leaky `refund_issued` column before training.
# This is the minimal, correct fix — one line change in build_features().

import os
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline


DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "churn.csv")


def load_data() -> pd.DataFrame:
    return pd.read_csv(DATA_PATH)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build model-ready features with the leaky column removed.

    refund_issued is only populated after a customer has churned (it reflects
    a post-cancellation business action). At prediction time every live
    customer has refund_issued == 0, so including it trains the model on a
    signal that is a disguised proxy for the label. Dropping it forces the
    model to learn from genuinely observable pre-churn signals.
    """
    features = df.copy()

    # One-hot encode the categorical column
    features = pd.get_dummies(features, columns=["contract_type"], drop_first=False)

    # Drop the label
    features = features.drop(columns=["churned"])

    # FIX: remove the leaky column — it encodes post-churn information
    features = features.drop(columns=["refund_issued"])

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
    print("Reference solution trained successfully.")
    print(f"Feature count: {pipeline.n_features_in_}")
