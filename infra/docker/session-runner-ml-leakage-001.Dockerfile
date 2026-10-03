# infra/docker/session-runner-ml-leakage-001.Dockerfile
#
# Session-runner image for ml-leakage-001.
# Contains: starter code, data, visible tests. NO hidden tests.
#
# Build from monorepo root:
#   docker build -f infra/docker/session-runner-ml-leakage-001.Dockerfile \
#                -t heisenbug-session-runner-ml-leakage-001:latest .

FROM python:3.11-slim

LABEL role="session-runner" \
      problem="ml-leakage-001" \
      hidden-tests="false"

WORKDIR /app

# 1. Install pinned Python dependencies (cached layer)
RUN pip install --no-cache-dir \
      scikit-learn==1.4.2 \
      pandas==2.2.2 \
      numpy==1.26.4 \
      pytest==8.2.2 \
      pytest-json-report==1.5.0

# 2. Copy data
COPY packages/problems/ml-leakage-001/repo/data ./data

# 3. Copy starter source
COPY packages/problems/ml-leakage-001/repo/src ./src

# 4. Copy ONLY visible tests — hidden tests must never appear in this image
COPY packages/problems/ml-leakage-001/repo/tests/visible ./tests/visible

# 5. Build-time assertion: prove hidden tests are NOT present
RUN if [ -d /app/tests/hidden ]; then \
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \
      exit 1; \
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

# Default command for debugging; overridden at runtime
CMD ["sh"]
