# infra/docker/session-runner-be-nplusone-001.Dockerfile
FROM node:20-alpine

LABEL role="session-runner" \
      problem="be-nplusone-001" \
      hidden-tests="false"

WORKDIR /app

COPY packages/problems/be-nplusone-001/repo/package.json ./package.json
RUN npm install --prefer-offline

COPY packages/problems/be-nplusone-001/repo/jest.config.js ./jest.config.js
COPY packages/problems/be-nplusone-001/repo/src             ./src
COPY packages/problems/be-nplusone-001/repo/tests/visible ./tests/visible

RUN if [ -d /app/tests/hidden ]; then \
      echo "ERROR: hidden tests found in session-runner image — aborting build" >&2; \
      exit 1; \
    fi && echo "✓ ISOLATION CHECK PASSED: /app/tests/hidden does not exist"

CMD ["sh"]
