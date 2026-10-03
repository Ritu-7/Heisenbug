# infra/docker/session-runner-be-idempotency-001.Dockerfile
#
# Session-runner image for be-idempotency-001.
# Contains: starter code, visible tests, mocks, NO hidden tests.
#
# Build from monorepo root:
#   docker build -f infra/docker/session-runner-be-idempotency-001.Dockerfile \
#                -t heisenbug-session-runner-be-idempotency-001:latest .

FROM node:20-alpine

LABEL role="session-runner" \
      problem="be-idempotency-001" \
      hidden-tests="false"

WORKDIR /app

# 1. Install dependencies first (cache layer)
COPY packages/problems/be-idempotency-001/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source, mocks, config
COPY packages/problems/be-idempotency-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-idempotency-001/repo/__mocks__       ./__mocks__
COPY packages/problems/be-idempotency-001/repo/src             ./src

# 3. Copy ONLY visible tests — hidden tests must never appear in this image
COPY packages/problems/be-idempotency-001/repo/tests/visible ./tests/visible

# 4. Build-time assertion: prove hidden tests are NOT present
RUN if [ -d /app/tests/hidden ]; then \
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \
      exit 1; \
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

# Default command for debugging; overridden at runtime
CMD ["sh"]
