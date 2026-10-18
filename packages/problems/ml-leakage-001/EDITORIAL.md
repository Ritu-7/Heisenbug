## Editorial — ML-042: Churn model scores 96% in testing, barely beats a coin flip in production

### Root cause

The model pipeline suffers from **target leakage** (data leakage). Specifically, the dataset contains the column `refund_issued`, which is only generated *after* a customer initiates account cancellation and requests a refund. 

When training and testing on historical snapshot data where churned users already have `refund_issued = 1`, the classifier learns a nearly 1:1 shortcut mapping (`refund_issued == 1 => churned = 1`). In production inference, however, predictions are made on currently active subscribers whose `refund_issued` is always `0`. The classifier has never learned to discern churn based on actual leading indicators (usage decline, support escalations, billing cadence), collapsing performance to random chance.

### Why it happens in production

Data leakage is among the most deceptive failure modes in machine learning because all standard validation metrics appear stellar during development:
1. **Post-event features in analytical data marts:** In data warehouses, ETL jobs aggregate tables into user-level summaries. Columns reflecting the resolution of an account (e.g. `cancellation_reason`, `post_churn_tickets`, `exit_survey_score`, `refund_issued`) sit side-by-side with pre-churn attributes.
2. **Global preprocessing before splitting:** Fitting scalers (`StandardScaler`), encoders (`OneHotEncoder`), or imputers across the entire dataset before calling `train_test_split` leaks test distribution statistics into training.
3. **Random vs. temporal splitting:** Splitting time-series or sequential customer logs with a random uniform split leaks future behavior into past records, and allows the same customer to appear in both train and test partitions.
4. **Accuracy paradox on imbalanced classes:** If churn rate is 4%, a model predicting 100% negative achieves 96% accuracy while identifying zero at-risk customers.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Feature Auditing & Domain Timeline Cutoff (Recommended)** | Eliminates target leakage permanently; ensures features represent strictly pre-prediction state. | Requires strict data documentation and timestamp awareness in ETL. | All supervised learning pipelines. |
| **Scikit-learn Pipeline with Strict Preprocessing Encapsulation** | Prevents data leakage from transforms/imputers; reproducible; cross-validation safe. | Slightly more boilerplate to configure column transformers. | Any scikit-learn or tabular ML project. |
| **Post-Hoc Feature Importance Pruning** | Catches dominant leaky features quickly during exploration. | Reactive rather than proactive; subtle leakages may slip through. | Model diagnostics and sanity checks. |

### Recommended approach

1. **Remove Post-Event Features:** Exclude `refund_issued` and any column whose value cannot be known at inference time.
2. **Encapsulate in an `sklearn.pipeline.Pipeline`:** Place all transformers, scalers, and estimators inside a pipeline to guarantee transformations are fit exclusively on training folds.
3. **Temporal Split (Time-based validation):** Train on months $T_0 \dots T_k$, evaluate on month $T_{k+1}$. Never use random train/test splits for time-dependent phenomena.
4. **Appropriate Evaluation Metrics:** Do not rely on Accuracy. For class-imbalanced targets like churn, optimize and evaluate using **PR-AUC (Precision-Recall Area Under Curve)**, **ROC-AUC**, or **Recall @ Top K% Customers** at actionable decision thresholds.
5. **Baseline Comparison:** Always benchmark against a dummy majority-class baseline and a simple heuristic model (e.g., predict churn if zero logins in last 30 days) to verify that complexity brings real predictive lift.

```python
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_curve, auc

# Clean Pipeline: fit transforms strictly on training data
clean_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf", LogisticRegression(max_iter=1000, random_state=42))
])
```

### Complexity / performance notes

- **Training Complexity:** $O(N \cdot D)$ for logistic regression with $N$ samples and $D$ features.
- **Inference Latency:** Sub-millisecond vector dot product, ideal for low-latency batch scoring or real-time API triggers.
- **Model Generalization:** Dropping the single leaky feature shifts cross-validation score down from an artificial 96% to a realistic ~78-84%, but guarantees the model retains genuine predictive power in production.

### Common pitfalls

- **Fitting transformations globally:** Running `scaler.fit(X)` on the entire dataset prior to splitting leaks mean and variance from test into train.
- **Overlooking temporal relationships:** Measuring `days_since_last_login` relative to the date the dataset was exported instead of the prediction cutoff timestamp.
- **Customer ID overlap:** Performing random splitting when multiple rows exist per customer, allowing the model to memorize user-specific idiosyncrasies across splits. Use `GroupKFold` on `customer_id`.
- **Ignoring feature importance anomalies:** If a single feature exhibits an overwhelming Shapley value or feature importance (> 70%), it is almost always a target leak rather than a breakthrough signal.

### How to verify the fix

1. **Feature importance check:** Inspect model coefficients (`model.named_steps['clf'].coef_`). Verify no single feature dominates the decision boundary unnaturally.
2. **Inference with zeroed post-event signals:** Evaluate the model on test instances where `refund_issued` is set to 0. A non-leaky model's predictions will remain consistent and calibrated.
3. **Temporal holdout validation:** Evaluate on an out-of-time test batch collected after the training timeframe. The PR-AUC and recall must hold steady without collapsing.
