# Multi-stage build for production-ready Node.js application
FROM node:18-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory with proper permissions
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

# Switch to node user for security
USER node

# Copy package files
COPY --chown=node:node package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application source
COPY --chown=node:node src/ ./src/

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "src/index.js"]
