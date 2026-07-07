FROM node:24-alpine

# Unraid Integration Labels
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/cj0r/lftp-sync-manager/development/public/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT]"

# Install system updates, lftp, openssh-client, and util-linux (for PTY/script support)
RUN apk update && apk upgrade --no-cache && apk add --no-cache lftp openssh-client util-linux

# Upgrade npm globally to resolve security vulnerabilities in the base image's pre-installed npm package
RUN npm install -g npm@latest

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy app source code
COPY . .

# Expose port
EXPOSE 9342

# Environment defaults
ENV PORT=9342
ENV CONFIG_DIR=/config

# Run the app
CMD ["node", "server.js"]
