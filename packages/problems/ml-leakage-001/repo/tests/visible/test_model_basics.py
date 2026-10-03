# packages/problems/ml-leakage-001/repo/tests/visible/test_model_basics.py
#
# Visible test suite for ml-leakage-001.
# These tests run in the session-runner image (no hidden tests).
#
# Test ID / weight convention:
#   def test_v<id>_<weight>_<description>(): → id=V<id>, weight pts
#
# Visible weights: V1=10, V2=20, V3=30  → 60 visible points
# (Hidden: H1=25, H2=15  → 40 hidden points)
# Grand total: 100 pts
#
# All visible tests must PASS on the buggy starter — they only check that
# the script runs and produces plausible output. The hidden tests catch the
# actual leakage bug.

import sys
import os
import pytest
import numpy as np
import pandas as pd

# Make the repo src importable from the test
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))
from train import train_model, load_data, build_features


# ── V1: script runs and returns a fitted Pipeline ────────────────────────────

def test_v1_10_train_model_returns_fitted_pipeline():
    """
    [V1:10] train_model() must return a fitted sklearn Pipeline without
    raising any exception.  The pipeline must expose predict() and
    predict_proba() — i.e. it must be a classifier, not a regressor.
    """
    pipeline = train_model()

    # Must have a predict method (fitted classifier)
    assert hasattr(pipeline, "predict"), "Pipeline must have a predict() method"
    assert hasattr(pipeline, "predict_proba"), "Pipeline must have a predict_proba() method"

    # Must know how many features it was trained on
    assert hasattr(pipeline, "n_features_in_"), (
        "Fitted pipeline must expose n_features_in_"
    )
    assert pipeline.n_features_in_ > 0, "n_features_in_ must be positive"


# ── V2: predict_proba output is well-formed ──────────────────────────────────

def test_v2_20_predict_proba_shape_and_range():
    """
    [V2:20] predict_proba(X) must return a 2-D array of shape (n_samples, 2)
    with values in [0, 1] that sum to 1.0 across columns (binary classifier).
    """
    df       = load_data()
    X        = build_features(df)
    pipeline = train_model()

    proba = pipeline.predict_proba(X)

    assert proba.ndim == 2, f"predict_proba must return 2-D array, got {proba.ndim}-D"
    assert proba.shape[0] == len(df), (
        f"Expected {len(df)} rows, got {proba.shape[0]}"
    )
    assert proba.shape[1] == 2, (
        f"Binary classifier must have 2 probability columns, got {proba.shape[1]}"
    )
    assert np.all(proba >= 0), "All probabilities must be >= 0"
    assert np.all(proba <= 1), "All probabilities must be <= 1"

    row_sums = proba.sum(axis=1)
    assert np.allclose(row_sums, 1.0, atol=1e-6), (
        "Probabilities must sum to 1.0 per row"
    )


# ── V3: held-out accuracy clears a naive baseline ────────────────────────────

def test_v3_30_held_out_accuracy_clears_baseline():
    """
    [V3:30] On a stratified held-out split (20 % of data), the model must
    achieve accuracy above 0.55 — better than a majority-class baseline.

    This test passes on the buggy starter (leaky model is very accurate on
    in-distribution data). The hidden tests catch what it misses.
    """
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import accuracy_score

    df    = load_data()
    y     = df["churned"]
    X     = build_features(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=99, stratify=y
    )

    pipeline = train_model()  # trains on full dataset — intentional for this check

    # Predict on the held-out slice
    preds = pipeline.predict(X_test)
    acc   = accuracy_score(y_test, preds)

    assert acc > 0.55, (
        f"Accuracy {acc:.3f} does not clear the 0.55 baseline. "
        "Check that the model is actually training."
    )
