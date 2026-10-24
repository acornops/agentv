# Exercise the real distro curl without claiming full Ubuntu 20.04 support.
FROM node:22-bullseye-slim AS node
FROM ubuntu:20.04
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl --version | grep -q '^curl 7\.68\.0 '
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /workspace
CMD ["node", "scripts/bootstrap-smoke.mjs"]
