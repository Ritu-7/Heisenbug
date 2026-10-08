# Near-Miss: Feature Transformation Instead of Dropping Leak (`log_transform_leaky.py`)

### The Flaw
This implementation recognizes that the `refund_issued` column is problematic, but attempts to "normalize" or rescale it using `np.log1p(features["refund_issued"])` rather than removing it from the training features entirely:
```python
# "Fix" the leaky column by scaling it (does NOT fix the leak)
features["refund_issued"] = np.log1p(features["refund_issued"])
```
The root cause of data leakage is temporal information leakage — `refund_issued` is recorded after cancellation or churn occurs. Rescaling a post-churn signal does not remove the leak; the model still learns to associate any non-zero value with churn.

### Why It Fools Visible Tests
- **V1 (20 pts)**: Pipeline trains without errors.
- **V2 (20 pts)**: Probabilities outputted by `predict_proba` are valid floats between 0 and 1.
- **V3 (20 pts)**: In-sample / basic test accuracy remains artificially inflated because the rescaled leaky feature is still available.
- **Visible Score**: 60/60.

### Which Hidden Check Catches It
- **Fails H1 (25 pts)**: `[H1:25] test_h1_25_production_simulation_accuracy`. In production simulation where `refund_issued` is 0 at inference time for active users, the model's accuracy collapses to near random chance (< 0.62).
- **Fails H2 (15 pts)**: `[H2:15] test_h2_15_leaky_column_excluded`. The feature inspection check verifies that `refund_issued` has a near-zero coefficient or is dropped. Because the column is still active and heavily weighted, this test fails.
- **Final Grader Score**: 60/100 (Passes all visible tests [V1, V2, V3], fails hidden checks [H1, H2]).
