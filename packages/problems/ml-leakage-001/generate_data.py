"""
Dataset generator for ml-leakage-001.

Design goals:
  - refund_issued: 90% of churners, 5% of non-churners -> very strong leaky signal
  - Legitimate features (tenure, monthly_charges, contract_type, etc.) carry
    MODERATE real predictive power -- enough that a model trained WITHOUT the
    leaky column achieves ~65-70% accuracy on a production-sim split
  - A model that INCLUDES refund_issued relies primarily on it, so when
    refund_issued=0 at serve time, it regresses toward chance (~50-52%)

Fixed seed = 42, N = 600 rows.
"""
import csv
import os
import random

random.seed(42)

CONTRACTS = ["month-to-month", "one-year", "two-year"]
N = 600

rows = []
for _ in range(N):
    tenure          = random.randint(1, 72)
    monthly_charges = round(random.uniform(18, 120), 2)
    support_tickets = random.randint(0, 6)
    contract_type   = random.choice(CONTRACTS)
    auto_pay        = random.choice([0, 1])

    # Legitimate signal
    base = 0.30
    if contract_type == "month-to-month":
        base += 0.28
    elif contract_type == "one-year":
        base += 0.10
    if tenure < 12:
        base += 0.16
    elif tenure < 24:
        base += 0.08
    elif tenure > 48:
        base -= 0.10
    if monthly_charges > 90:
        base += 0.14
    elif monthly_charges > 70:
        base += 0.06
    elif monthly_charges < 30:
        base -= 0.10
    if support_tickets >= 5:
        base += 0.12
    elif support_tickets >= 3:
        base += 0.05
    if auto_pay:
        base -= 0.07

    base = max(0.05, min(0.92, base))
    churned = 1 if random.random() < base else 0

    # LEAKY FEATURE
    if churned == 1:
        refund_issued = 1 if random.random() < 0.90 else 0
    else:
        refund_issued = 1 if random.random() < 0.05 else 0

    rows.append({
        "tenure": tenure,
        "monthly_charges": monthly_charges,
        "support_tickets": support_tickets,
        "contract_type": contract_type,
        "auto_pay": auto_pay,
        "refund_issued": refund_issued,
        "churned": churned,
    })

total_churners = sum(r["churned"] for r in rows)
refund_in_churners = sum(r["refund_issued"] for r in rows if r["churned"] == 1)
print(f"N={N}, churn_rate={total_churners/N:.1%}, "
      f"refund_in_churners={refund_in_churners}/{total_churners} "
      f"({refund_in_churners/total_churners:.1%})")

out_path = os.path.join(os.path.dirname(__file__), "repo", "data", "churn.csv")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
fields = ["tenure", "monthly_charges", "support_tickets", "contract_type", "auto_pay", "refund_issued", "churned"]
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"Wrote {N} rows to {out_path}")

