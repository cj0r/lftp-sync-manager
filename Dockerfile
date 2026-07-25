FROM node:24-alpine

# Unraid Integration Labels
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/cj0r/lftp-sync-manager/production/public/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT]"

# Install system updates, lftp, openssh-client, and util-linux (for PTY/script support)
RUN apk update && apk upgrade --no-cache && apk add --no-cache lftp openssh-client util-linux

# Upgrade npm globally before installing our own dependencies, to reduce the
# chance of picking up known-vulnerable versions of npm's own internal tools.
RUN npm install -g npm@latest

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
# The container only ever runs `node server.js` - npm/npx/corepack are never
# invoked at runtime. Remove npm's own global installation (and corepack)
# once our app's dependencies are installed. This is what actually resolves
# Docker Scout findings like CVE-2026-14257 (brace-expansion) and
# GHSA-r292-9mhp-454m (tar): those packages live inside npm's own vendored
# node_modules, not in this project's dependency tree, so bumping our own
# package.json can never fix them - only removing npm from the shipped image
# does. Combined into one RUN with the install so the removed files don't
# persist in an earlier layer.
RUN npm install --only=production && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Copy app source code
COPY . .

# Expose port
EXPOSE 9342

# Environment defaults
ENV PORT=9342
ENV CONFIG_DIR=/config

# Run the app
CMD ["node", "server.js"]
