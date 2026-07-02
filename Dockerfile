FROM node:20-alpine

# Install lftp, openssh-client and clean cache
RUN apk add --no-cache lftp openssh-client

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
