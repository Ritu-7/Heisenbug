# infra/docker/session-runner-sec-xss-001.Dockerfile
#
# Session-runner image for sec-xss-001.
# Contains: starter code, visible tests, NO hidden tests.
#
# Build from monorepo root:
#   docker build -f infra/docker/session-runner-sec-xss-001.Dockerfile \
#                -t heisenbug-session-runner-sec-xss-001:latest .

FROM node:20-alpine

LABEL role="session-runner" \
      problem="sec-xss-001" \
      hidden-tests="false"

WORKDIR /app

# 1. Install dependencies first
COPY packages/problems/sec-xss-001/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source and config
COPY packages/problems/sec-xss-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/sec-xss-001/repo/src             ./src

# 3. Copy ONLY visible tests — hidden tests must never appear in this image
COPY packages/problems/sec-xss-001/repo/tests/visible ./tests/visible

# 4. Build-time assertion: prove hidden tests are NOT present
RUN if [ -d /app/tests/hidden ]; then \
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \
      exit 1; \
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

CMD ["sh"]
