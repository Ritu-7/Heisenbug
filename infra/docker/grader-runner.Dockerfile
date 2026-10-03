# infra/docker/grader-runner.Dockerfile
#
# Grader-runner image: used ONLY for Submit grading.
# Hidden tests are NOT baked in — they are mounted at runtime from the HOST
# via a Docker volume. If the volume is not mounted, hidden tests don't run.
#
# Build from monorepo root:
#   docker build -f infra/docker/grader-runner.Dockerfile \
#                -t heisenbug-grader-runner:latest .

FROM node:20-alpine

LABEL role="grader-runner" \
      problem="be-idempotency-001" \
      hidden-tests="mounted-at-runtime"

WORKDIR /app

# 1. Install dependencies
COPY packages/problems/be-idempotency-001/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source, mocks, config (same as session-runner)
COPY packages/problems/be-idempotency-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-idempotency-001/repo/__mocks__       ./__mocks__
COPY packages/problems/be-idempotency-001/repo/src             ./src

# 3. Visible tests baked in
COPY packages/problems/be-idempotency-001/repo/tests/visible ./tests/visible

# 4. Create EMPTY hidden tests mount point with correct ownership.
#    This directory must exist for the volume mount to work, but must be EMPTY
#    in the image — content comes exclusively from the host mount at runtime.
RUN mkdir -p /app/tests/hidden && \
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

# 5. Build-time assertion: the directory is truly empty
RUN [ -z "$(ls -A /app/tests/hidden)" ] && \
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
