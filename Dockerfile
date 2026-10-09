FROM node:24-alpine

# Unraid Integration Labels
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/cj0r/lftp-sync-manager/production/public/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT]"

# Set by the release workflow; shown on Docker Hub and by `docker inspect`.
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="LFTP Sync Manager" \
      org.opencontainers.image.source="https://github.com/cj0r/lftp-sync-manager" \
      org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# Install system updates, lftp, openssh-client, util-linux (for PTY/script
# support), and tini (see ENTRYPOINT below)
RUN apk upgrade --no-cache && apk add --no-cache lftp openssh-client util-linux tini && \
    # Fail the build, not the container, if tini ever moves: a bad ENTRYPOINT
    # path only shows up as an image that refuses to start.
    test -x /sbin/tini

WORKDIR /app

# Install exactly what pnpm-lock.yaml pins (the version comes from
# package.json's packageManager field, via corepack). `npm install` here used
# to ignore the lockfile entirely, so every build could resolve different
# dependency versions than the ones tested.
#
# The container only ever runs `node server.js` - npm/npx/corepack/pnpm are
# never invoked at runtime. Removing them once dependencies are installed is
# what resolves Docker Scout findings like CVE-2026-14257 (brace-expansion) and
# GHSA-r292-9mhp-454m (tar): those packages live inside npm's own vendored
# node_modules, not in this project's dependency tree, so bumping our own
# package.json can never fix them - only removing npm from the shipped image
# does. Combined into one RUN with the install so the removed files don't
# persist in an earlier layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --prod --frozen-lockfile && \
    rm -rf /root/.cache /root/.local/share/pnpm \
           /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/pnpm /usr/local/bin/pnpx

# Copy only what the app runs, so nothing else in the build context (local
# configs, notes, test captures) can end up in a published image.
COPY server.js ./
COPY public ./public

# Expose port
EXPOSE 9342

# Environment defaults
ENV PORT=9342
ENV CONFIG_DIR=/config

# Lets Docker, Unraid, Portainer and the like show whether the web UI answers.
# /api/auth/status is public and a loopback request is always allowed in.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9342)+'/api/auth/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Run the app under tini as PID 1.
#
# lftp drives a real `ssh` child process per connection (sftp:connect-program),
# and a sync can hold nsegment x nfile of them at once. Whenever one of those
# grandchildren is orphaned - an aborted transfer, a killed pre-check, a crash -
# it is reparented to PID 1. Node only ever waitpid()s processes it spawned
# itself, so as PID 1 it never reaps them and each one holds a process slot for
# the lifetime of the container. That accumulation eventually made fork() fail
# with EAGAIN, which the app then misread as the remote host refusing it.
# tini reaps orphans properly and forwards signals, so the container no longer
# leaks process slots and only ever needs restarting for real reasons.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
