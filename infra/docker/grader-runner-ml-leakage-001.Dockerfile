# infra/docker/grader-runner-ml-leakage-001.Dockerfile
#
# Grader-runner image for ml-leakage-001.
# Hidden tests are NOT baked in — they are mounted at runtime from the HOST
# via a Docker volume. If the volume is not mounted, hidden tests don't run.
#
# Build from monorepo root:
#   docker build -f infra/docker/grader-runner-ml-leakage-001.Dockerfile \
#                -t heisenbug-grader-runner-ml-leakage-001:latest .

FROM python:3.11-slim

LABEL role="grader-runner" \
      problem="ml-leakage-001" \
      hidden-tests="mounted-at-runtime"

WORKDIR /app

# 1. Install pinned Python dependencies
RUN pip install --no-cache-dir \
      scikit-learn==1.4.2 \
      pandas==2.2.2 \
      numpy==1.26.4 \
      pytest==8.2.2 \
      pytest-json-report==1.5.0

# 2. Copy data
COPY packages/problems/ml-leakage-001/repo/data ./data

# 3. Copy starter source (candidate's entryFile will be volume-mounted over src/train.py)
COPY packages/problems/ml-leakage-001/repo/src ./src

# 4. Visible tests baked in
COPY packages/problems/ml-leakage-001/repo/tests/visible ./tests/visible

# 5. Create EMPTY hidden tests mount point with correct ownership.
#    This directory must exist for the volume mount to work, but must be EMPTY
#    in the image — content comes exclusively from the host mount at runtime.
RUN mkdir -p /app/tests/hidden && \
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

# 6. Build-time assertion: the directory is truly empty
RUN [ -z "$(ls -A /app/tests/hidden)" ] && \
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
