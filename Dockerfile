# ==============================================================================
# Green Future Tech (GFT) - Backend Production Dockerfile
# ==============================================================================
FROM node:20-alpine AS base

# Install curl for health check
RUN apk add --no-cache curl

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Create logs directory
RUN mkdir -p logs uploads

# Non-root user for security
USER node

EXPOSE 5000

ENV PORT=5000 \
    NODE_ENV=production

# Health check against Express /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]
