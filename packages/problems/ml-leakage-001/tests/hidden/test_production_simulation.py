# packages/problems/ml-leakage-001/tests/hidden/test_production_simulation.py
#
# Hidden test suite for ml-leakage-001.
# NOT included in the session-runner image. Mounted from the host at submit time:
#   HOST : packages/problems/ml-leakage-001/tests/hidden/
#   → CONTAINER: /app/tests/hidden/
#
# Test ID / weight convention:
#   def test_h<id>_<weight>_<description>(): → id=H<id>, weight pts
#
# H1=25, H2=15  → 40 hidden points
# Grand total with visible (60) = 100 pts
#
# DESIGN INTENT
# ─────────────
# Both tests independently catch target leakage in refund_issued.
#
# H1 — "production simulation":
#   Force refund_issued=0 for every row in the test set (the value it would
#   actually have at inference time, before the customer has churned).
#   A leaky model trained on refund_issued≈1 for churners loses its main
#   signal and drops close to chance. A clean model is unaffected.
#
# H2 — "leaky column exclusion":
#   After training, inspect the fitted LogisticRegression coefficients.
#   refund_issued must NOT appear in the final feature set used to train the
#   model — or if it does, its absolute coefficient must be near-zero.
#   This is an independent structural check that doesn't require held-out data.

import sys
import os
import pytest
import numpy as np
import pandas as pd

sys.path.insert(0, "/app/src")
from train import train_model, load_data, build_features


# ── H1: production simulation ────────────────────────────────────────────────

def test_h1_25_production_simulation_accuracy():
    """
    [H1:25] Simulate serving the model in production: zero out `refund_issued`
    for every row in a held-out test set (it would be 0 for every live customer
    who has not yet churned or gone through cancellation).

    A model that learned to rely on this leaky column will see its accuracy
    collapse when the column is 0 everywhere; a correctly fixed model is
    unaffected because it was trained without the column.

    Threshold: accuracy on the production-simulated test set must be >= 0.60.
    The buggy starter typically scores <= 0.50 on this check (near random).
    """
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score

    df = load_data()
    y  = df["churned"].values

    # Split before any feature engineering so we have raw rows for simulation
    idx = np.arange(len(df))
    train_idx, test_idx = train_test_split(idx, test_size=0.30, random_state=7, stratify=y)

    df_test = df.iloc[test_idx].copy()
    y_test  = y[test_idx]

    # ── Production simulation ──────────────────────────────────────────────
    # At prediction time a customer has not yet churned → refund_issued is 0.
    if "refund_issued" in df_test.columns:
        df_test["refund_issued"] = 0

    # Build features using the candidate's own build_features (so column
    # alignment is guaranteed regardless of which columns they kept/dropped).
    X_test = build_features(df_test)

    # Retrain the pipeline on the training split (not the full dataset) so
    # we test true generalisation on unseen rows.
    df_train = df.iloc[train_idx].copy()
    y_train  = y[train_idx]
    X_train  = build_features(df_train)

    # Align test columns to training columns (handles one-hot dummies)
    X_test = X_test.reindex(columns=X_train.columns, fill_value=0)

    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("clf",    LogisticRegression(max_iter=1000, random_state=42)),
    ])
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    acc   = accuracy_score(y_test, preds)

    assert acc >= 0.60, (
        f"Production-simulation accuracy is {acc:.3f} — too low. "
        "A model relying on refund_issued collapses when that column is 0 "
        "at inference time. Drop the leaky column from build_features()."
    )


# ── H2: leaky column coefficient / exclusion check ───────────────────────────

def test_h2_15_refund_issued_excluded_or_near_zero_coefficient():
    """
    [H2:15] After training, `refund_issued` must either be absent from the
    feature set entirely, or — if the candidate chose to keep it and zero
    it out somehow — its absolute LogisticRegression coefficient must be
    below 0.10 (effectively zero relative to legitimate features).

    This is a structural check independent of held-out accuracy. It directly
    verifies that the leaky column cannot influence predictions.
    """
    df = load_data()
    X  = build_features(df)
    y  = df["churned"]

    # Case 1 — column was dropped: trivially passes
    if "refund_issued" not in X.columns:
        return  # ✓ clean

    # Case 2 — column is present: inspect its coefficient
    pipeline = train_model()
    clf      = pipeline.named_steps["clf"]

    feature_names = list(X.columns)
    coef          = clf.coef_[0]          # shape (n_features,) for binary LR

    assert len(coef) == len(feature_names), (
        "Coefficient vector length does not match feature count — "
        "pipeline structure unexpected."
    )

    ref_idx   = feature_names.index("refund_issued")
    ref_coef  = abs(coef[ref_idx])

    assert ref_coef < 0.10, (
        f"refund_issued has |coefficient| = {ref_coef:.4f}, which is too large. "
        "The leaky column is still influencing predictions. "
        "Drop it from build_features() instead."
    )
