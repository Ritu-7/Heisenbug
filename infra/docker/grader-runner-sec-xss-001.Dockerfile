# infra/docker/grader-runner-sec-xss-001.Dockerfile
#
# Grader-runner image for sec-xss-001.
# Hidden tests are NOT baked in — they are mounted at runtime from the HOST
# via a Docker volume. If the volume is not mounted, hidden tests don't run.
#
# Build from monorepo root:
#   docker build -f infra/docker/grader-runner-sec-xss-001.Dockerfile \
#                -t heisenbug-grader-runner-sec-xss-001:latest .

FROM node:20-alpine

LABEL role="grader-runner" \
      problem="sec-xss-001" \
      hidden-tests="mounted-at-runtime"

WORKDIR /app

# 1. Install dependencies
COPY packages/problems/sec-xss-001/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source and config
COPY packages/problems/sec-xss-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/sec-xss-001/repo/src             ./src

# 3. Visible tests baked in
COPY packages/problems/sec-xss-001/repo/tests/visible ./tests/visible

# 4. Create EMPTY hidden tests mount point with correct ownership.
RUN mkdir -p /app/tests/hidden && \
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

# 5. Build-time assertion: the directory is truly empty
RUN [ -z "$(ls -A /app/tests/hidden)" ] && \
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
