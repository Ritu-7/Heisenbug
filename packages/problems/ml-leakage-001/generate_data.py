"""
Generate the synthetic churn dataset for ml-leakage-001.
Fixed random seed — output is deterministic.
Run once from repo root: python packages/problems/ml-leakage-001/generate_data.py
"""
import csv
import random
import math
import os

random.seed(42)

CONTRACTS = ["month-to-month", "one-year", "two-year"]
N = 300

rows = []
for i in range(N):
    tenure           = random.randint(1, 72)           # months
    monthly_charges  = round(random.uniform(18, 120), 2)
    support_tickets  = random.randint(0, 8)
    contract_type    = random.choice(CONTRACTS)
    auto_pay         = random.choice([0, 1])

    # True churn probability (no leaky info used here)
    base = 0.05
    if contract_type == "month-to-month":
        base += 0.25
    if tenure < 6:
        base += 0.20
    if monthly_charges > 80:
        base += 0.15
    if support_tickets >= 4:
        base += 0.10
    if auto_pay:
        base -= 0.05
    base = max(0.02, min(0.95, base))

    churned = 1 if random.random() < base else 0

    # ────────────────────────────────────────────────────────────────────────
    # LEAKY FEATURE: refund_issued
    # In the real world this value is only ever recorded AFTER a customer
    # has initiated cancellation.  During a live inference call the customer
    # has not churned yet, so this field would be 0 / NaN for everyone.
    # Including it in training teaches the model to predict the outcome from
    # a feature that IS the outcome (just noisily encoded).
    # ────────────────────────────────────────────────────────────────────────
    if churned == 1:
        refund_issued = 1 if random.random() < 0.85 else 0   # mostly 1 for churners
    else:
        refund_issued = 1 if random.random() < 0.04 else 0   # rarely 1 for non-churners

    rows.append({
        "tenure":           tenure,
        "monthly_charges":  monthly_charges,
        "support_tickets":  support_tickets,
        "contract_type":    contract_type,
        "auto_pay":         auto_pay,
        "refund_issued":    refund_issued,      # THE LEAKY COLUMN
        "churned":          churned,
    })

out_path = os.path.join(os.path.dirname(__file__), "repo", "data", "churn.csv")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
fields = ["tenure", "monthly_charges", "support_tickets", "contract_type", "auto_pay", "refund_issued", "churned"]
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"Wrote {N} rows to {out_path}")
print(f"Churn rate: {sum(r['churned'] for r in rows)/N:.1%}")
