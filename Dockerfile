FROM node:20-alpine

# Unraid Integration Labels
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/cj0r/lftp-gui/development/public/icon.png"
LABEL net.unraid.docker.webui="http://[IP]:[PORT]"

# Install lftp, openssh-client, util-linux (for PTY/script support) and clean cache
RUN apk add --no-cache lftp openssh-client util-linux

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
