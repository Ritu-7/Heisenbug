# infra/docker/grader-runner-be-race-002.Dockerfile
#
# Grader-runner image for be-race-002.
# Hidden tests are NOT baked in — they are mounted at runtime from the HOST.
#
# Build from monorepo root:
#   docker build -f infra/docker/grader-runner-be-race-002.Dockerfile \
#                -t heisenbug-grader-runner-be-race-002:latest .

FROM node:20-alpine

LABEL role="grader-runner" \
      problem="be-race-002" \
      hidden-tests="mounted-at-runtime"

WORKDIR /app

# 1. Install dependencies
COPY packages/problems/be-race-002/repo/package.json ./package.json
RUN npm install --prefer-offline

# 2. Copy source and jest config
COPY packages/problems/be-race-002/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-race-002/repo/src             ./src

# 3. Visible tests baked in
COPY packages/problems/be-race-002/repo/tests/visible ./tests/visible

# 4. Create EMPTY hidden tests mount point.
#    Content comes exclusively from the host mount at runtime.
RUN mkdir -p /app/tests/hidden && \
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

# 5. Build-time assertion: the directory is truly empty
RUN [ -z "$(ls -A /app/tests/hidden)" ] && \
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
