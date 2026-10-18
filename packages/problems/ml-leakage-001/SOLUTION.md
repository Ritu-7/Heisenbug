## Reference Solution — ML-042: Churn model scores 96% in testing, barely beats a coin flip in production

### Full corrected code

```python
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
```

### Line-by-line explanation

- **Lines 13-17:** Load the churn dataset from `DATA_PATH` using `pandas.read_csv`.
- **Lines 20-33:** Create a defensive copy of the dataframe and apply one-hot encoding across the categorical `contract_type` column via `pd.get_dummies`.
- **Line 36:** Drop `churned` from the feature matrix so the target label is not included in the inputs.
- **Line 39 (The Fix):** Drop the leaky `refund_issued` column from `features`. This ensures the model learns exclusively from authentic pre-churn indicators (tenure, monthly spend, support inquiries).
- **Lines 44-54:** Construct an scikit-learn `Pipeline` pairing `StandardScaler` with `LogisticRegression`. Fit the pipeline on $(X, y)$ and return the trained estimator.

### Diff against starter code

```diff
@@ -36,8 +36,8 @@
     # Drop the label — it must never be a feature
     features = features.drop(columns=["churned"])
 
-    # BUG: refund_issued is populated ONLY after a customer cancels their
-    # account...
-    # features = features.drop(columns=["refund_issued"])   # ← uncomment this line
+    # FIX: remove the leaky column — it encodes post-churn information
+    features = features.drop(columns=["refund_issued"])
 
     return features
```
