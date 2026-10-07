# infra/docker/grader-runner-be-nplusone-001.Dockerfile
FROM node:20-alpine

LABEL role="grader-runner" \
      problem="be-nplusone-001" \
      hidden-tests="mounted-at-runtime"

WORKDIR /app

COPY packages/problems/be-nplusone-001/repo/package.json ./package.json
RUN npm install --prefer-offline

COPY packages/problems/be-nplusone-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-nplusone-001/repo/src             ./src
COPY packages/problems/be-nplusone-001/repo/tests/visible ./tests/visible

RUN mkdir -p /app/tests/hidden && \
    echo "✓ Mount point /app/tests/hidden created (empty — populated by host volume at runtime)"

RUN [ -z "$(ls -A /app/tests/hidden)" ] && \
    echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden is empty in grader image"

CMD ["sh"]
