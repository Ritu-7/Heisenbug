# ML-042 · Churn model scores 96% in testing, barely beats a coin flip in production

**Track:** Machine Learning · **Difficulty:** Medium · **Est. time:** 30 min  
**Skills:** data-leakage · feature-engineering · model-evaluation  
**Stack:** Python · scikit-learn · pytest

---

## Ticket context

**Reported by:** Data Science Team / Lead ML Engineer  
**Severity:** 🔴 High  
**Affects:** Production — churn prediction pipeline  
**Reproducibility:** Immediate upon production deployment  

### User-facing symptom

A churn-prediction classifier achieved 96% accuracy during validation and cross-validation on historical data. However, as soon as the model was deployed to production to score live customers, its prediction accuracy collapsed to ~50% (barely beating a coin flip).

### Reproduction steps

1. Train the pipeline using `src/train.py`.
2. Evaluate accuracy on historical held-out data → 96% accuracy.
3. Evaluate the model in a production simulation where live customers have not yet churned (i.e. post-churn events like refunds have not occurred) → accuracy drops to chance (~50%).

### Root-cause area (your job is to fix it)

`src/train.py` — `build_features()` includes the column `refund_issued`. This column is only populated AFTER a customer cancels their account / churns. At prediction time for live active customers, this field is always 0. The model learned to rely almost entirely on this target-leakage feature.

---

## Requirements you must satisfy

### R1 — Identify and remove target leakage
- Inspect features created in `build_features()`.
- Identify the feature that represents post-churn information (`refund_issued`).
- Drop `refund_issued` before returning the feature DataFrame.

### R2 — Maintain valid pipeline interface
- `train_model()` must return a fitted scikit-learn `Pipeline`.
- The returned pipeline must expose `.predict(X)` and `.predict_proba(X)`.

---

## Acceptance criteria (auto-checked)

| ID | Suite | Check | Weight |
|----|-------|-------|--------|
| V1 | Visible | `train_model()` returns a fitted classifier pipeline | 10 pts |
| V2 | Visible | `predict_proba()` output shape is valid and probabilities sum to 1.0 | 20 pts |
| V3 | Visible | Held-out accuracy clears 0.55 baseline | 30 pts |
| H1 | Hidden | Production simulation (zeroed post-churn fields) accuracy >= 0.60 | 25 pts |
| H2 | Hidden | `refund_issued` is excluded from training or has near-zero coefficient (< 0.10) | 15 pts |

**Visible total:** 60 pts · **Hidden total:** 40 pts · **Grand total:** 100 pts
