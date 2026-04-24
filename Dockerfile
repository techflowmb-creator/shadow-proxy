# Shadow Proxy Server - Docker Image
# Multi-stage build for optimized production image

FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install Redis client dependencies
RUN apk add --no-cache redis

# Create app user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S shadowproxy -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder
COPY --from=builder --chown=shadowproxy:nodejs /app/dist ./dist

# Switch to non-root user
USER shadowproxy

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV PROXY_PORT=8080
ENV PROXY_HOST=0.0.0.0

# Start the application
CMD ["node", "dist/index.js"]
