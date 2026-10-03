# infra/docker/session-runner-be-race-002.Dockerfile
#
# Session-runner image for be-race-002.
# Contains: buggy starter code, visible tests, NO hidden tests.
#
# Build from monorepo root:
#   docker build -f infra/docker/session-runner-be-race-002.Dockerfile \
#                -t heisenbug-session-runner-be-race-002:latest .

FROM node:20-alpine

LABEL role="session-runner" \
      problem="be-race-002" \
      hidden-tests="false"

WORKDIR /app

# 1. Install dependencies first (cache layer)
COPY packages/problems/be-race-002/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source and jest config (no __mocks__ — no external API to mock)
COPY packages/problems/be-race-002/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-race-002/repo/src             ./src

# 3. Copy ONLY visible tests — hidden tests must never appear in this image
COPY packages/problems/be-race-002/repo/tests/visible ./tests/visible

# 4. Build-time assertion: prove hidden tests are NOT present
RUN if [ -d /app/tests/hidden ]; then \
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \
      exit 1; \
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

# Default command for debugging; overridden at runtime
CMD ["sh"]
