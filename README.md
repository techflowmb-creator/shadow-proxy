# 🖤 Shadow Proxy

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/TypeScript-5.5+-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Redis-Supported-red?style=for-the-badge&logo=redis" alt="Redis">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License">
</p>

<p align="center">
  <strong>High-performance HTTP/HTTPS proxy server with caching, load balancing, and rate limiting</strong>
</p>

<p align="center">
  Shadow Proxy is a production-ready proxy server built for the modern web. It provides intelligent routing, caching, security features, and comprehensive monitoring — all with a focus on performance and reliability.
</p>

---

## ✨ Features

### 🚀 Core Proxy Functionality

- **HTTP/HTTPS Support** - Full proxy support for both HTTP and HTTPS protocols
- **WebSocket Support** - Real-time bidirectional communication support
- **SSL/TLS Termination** - Handle SSL certificates at the proxy level
- **HTTP/2 Ready** - Built with modern HTTP standards in mind

### ⚡ Performance & Caching

- **Multi-Tier Caching**
  - **In-Memory LRU Cache** - Lightning-fast responses for frequently accessed content
  - **Redis Integration** - Distributed caching for scaling across multiple instances
  - **Cache Invalidation API** - Programmatic control over cache lifecycle
- **Compression** - Automatic Gzip/Brotli compression for reduced bandwidth

### 🔄 Load Balancing

- **Multiple Algorithms**
  - **Round Robin** - Distribute requests evenly across backends
  - **Least Connections** - Route to the server with fewest active connections
  - **IP Hash** - Sticky sessions based on client IP address
  - **Weighted Round Robin** - Priority-based server selection

### 🛡️ Security & Rate Limiting

- **Rate Limiting**
  - Per-IP rate limiting
  - Per-user/customer rate limiting (API key based)
  - Configurable window sizes and burst allowances
  - Redis-backed distributed rate limiting
- **Security Headers** - Automatic security header injection (Helmet.js)
- **CORS Support** - Configurable cross-origin resource sharing

### 📊 Monitoring & Observability

- **Built-in Metrics Endpoint** - Prometheus-compatible metrics at `/metrics`
- **Health Checks** - `/health` endpoint for load balancer integration
- **Comprehensive Logging**
  - Structured JSON logging with Winston
  - Request/response logging with configurable verbosity
  - Log rotation support
- **Real-time Statistics** - Active connections, cache hit rates, throughput

### 🔧 Configuration & Deployment

- **Environment-Based Config** - 12-factor app compatible configuration
- **Docker Support** - Production-ready Docker and Docker Compose setup
- **Hot Reload** - Development mode with auto-restart on changes
- **Zero-Downtime Deployment** - Graceful shutdown handling

---

## 📦 Installation

### Prerequisites

- Node.js 18 or higher
- Redis (optional, for distributed caching)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/techflowmb-creator/shadow-proxy.git
cd shadow-proxy

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your settings

# Build the project
npm run build

# Start the server
npm start
```

### Development Mode

```bash
# Run in development mode with hot reload
npm run dev
```

---

## ⚙️ Configuration

Shadow Proxy is configured entirely through environment variables. Create a `.env` file in the project root:

### Server Configuration

```env
# Server Settings
PORT=8080                          # Port to listen on
HOST=0.0.0.0                       # Host to bind to
NODE_ENV=production                # Environment: development, production, test

# SSL/TLS Configuration
SSL_ENABLED=false                  # Enable HTTPS
SSL_CERT_PATH=/path/to/cert.pem    # SSL certificate path
SSL_KEY_PATH=/path/to/key.pem      # SSL private key path

# CORS Settings
CORS_ENABLED=true                  # Enable CORS
CORS_ORIGIN=*                      # Allowed origins (comma-separated or *)
CORS_METHODS=GET,POST,PUT,DELETE   # Allowed HTTP methods
```

### Backend Configuration

```env
# Target Backend Servers (comma-separated)
BACKEND_URLS=http://localhost:3001,http://localhost:3002,http://localhost:3003

# Load Balancing Algorithm
# Options: round-robin, least-connections, ip-hash, weighted-round-robin
LOAD_BALANCER=round-robin

# Health Check Settings
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000        # Milliseconds between health checks
HEALTH_CHECK_TIMEOUT=5000          # Health check timeout in milliseconds
HEALTH_CHECK_PATH=/health          # Path for backend health checks
```

### Caching Configuration

```env
# In-Memory LRU Cache
CACHE_ENABLED=true
CACHE_MAX_SIZE=1000                # Maximum number of cached entries
CACHE_TTL=3600000                  # Time to live in milliseconds (1 hour)

# Redis Cache (optional, for distributed caching)
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                    # Redis password (optional)
REDIS_DB=0                         # Redis database index
REDIS_KEY_PREFIX=shadow-proxy:     # Key prefix for cache entries
REDIS_CACHE_TTL=7200               # Redis cache TTL in seconds
```

### Rate Limiting Configuration

```env
# IP-Based Rate Limiting
RATE_LIMIT_IP_ENABLED=true
RATE_LIMIT_IP_WINDOW=900000        # Window size in milliseconds (15 minutes)
RATE_LIMIT_IP_MAX=100              # Maximum requests per window

# User-Based Rate Limiting (API Key)
RATE_LIMIT_USER_ENABLED=true
RATE_LIMIT_USER_WINDOW=3600000     # Window size in milliseconds (1 hour)
RATE_LIMIT_USER_MAX=1000           # Maximum requests per window

# Rate Limiting Storage
# Options: memory, redis
RATE_LIMIT_STORAGE=memory
```

### Logging Configuration

```env
# Logging Settings
LOG_LEVEL=info                     # Log level: error, warn, info, debug
LOG_FORMAT=json                    # Log format: json, simple
LOG_FILE_PATH=./logs/shadow-proxy.log    # Log file path (optional)
LOG_ROTATION_ENABLED=true          # Enable log rotation
LOG_RETENTION_DAYS=30              # Number of days to retain logs

# Request Logging
LOG_REQUESTS=true                  # Log incoming requests
LOG_RESPONSES=true                 # Log responses
LOG_BODY_MAX_SIZE=10000            # Maximum body size to log (bytes)
```

### Feature Toggles

```env
# Compression
COMPRESSION_ENABLED=true
COMPRESSION_LEVEL=6                # Compression level (1-9)

# Metrics
METRICS_ENABLED=true               # Enable Prometheus metrics endpoint

# WebSocket
WEBSOCKET_ENABLED=true             # Enable WebSocket support
WEBSOCKET_TIMEOUT=30000            # WebSocket timeout in milliseconds
```

---

## 🚀 Usage

### Basic Usage

Once configured and running, Shadow Proxy will forward requests to your backend servers:

```bash
# Forward HTTP request through proxy
curl http://localhost:8080/api/users

# Forward HTTPS request (if SSL enabled)
curl https://localhost:8080/api/users
```

### Health Check

```bash
# Check proxy health
curl http://localhost:8080/health

# Response:
# {
#   "status": "healthy",
#   "timestamp": "2024-01-15T10:30:00.000Z",
#   "uptime": 3600,
#   "version": "1.0.0",
#   "backends": {
#     "total": 3,
#     "healthy": 3,
#     "unhealthy": 0
#   }
# }
```

### Metrics

```bash
# Get Prometheus-compatible metrics
curl http://localhost:8080/metrics

# Example metrics:
# shadow_proxy_requests_total{status="200"} 1250
# shadow_proxy_cache_hits_total 850
# shadow_proxy_cache_misses_total 400
# shadow_proxy_active_connections 45
```

### Cache Management

```bash
# Invalidate specific cache key
curl -X POST http://localhost:8080/cache/invalidate \
  -H "Content-Type: application/json" \
  -d '{"key": "/api/users"}'

# Invalidate all cache
curl -X POST http://localhost:8080/cache/invalidate-all

# Get cache statistics
curl http://localhost:8080/cache/stats
```

### Custom Headers

Shadow Proxy automatically adds headers to proxied requests:

```
X-Forwarded-For: <client-ip>
X-Forwarded-Proto: <http|https>
X-Forwarded-Host: <original-host>
X-Shadow-Proxy: 1.0.0
X-Cache-Status: HIT|MISS|BYPASS
X-Rate-Limit-Remaining: <number>
X-Rate-Limit-Reset: <timestamp>
```

---

## 🐳 Docker Deployment

### Using Docker

```bash
# Build the Docker image
docker build -t shadow-proxy:latest .

# Run with environment variables
docker run -d \
  -p 8080:8080 \
  -e PORT=8080 \
  -e BACKEND_URLS=http://backend1:3000,http://backend2:3000 \
  -e CACHE_ENABLED=true \
  -e REDIS_ENABLED=true \
  -e REDIS_HOST=redis \
  --name shadow-proxy \
  shadow-proxy:latest
```

### Using Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: "3.8"

services:
  shadow-proxy:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - NODE_ENV=production
      - BACKEND_URLS=http://backend1:3000,http://backend2:3000
      - CACHE_ENABLED=true
      - CACHE_MAX_SIZE=10000
      - REDIS_ENABLED=true
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - RATE_LIMIT_IP_ENABLED=true
      - RATE_LIMIT_IP_MAX=1000
      - LOG_LEVEL=info
      - METRICS_ENABLED=true
    depends_on:
      - redis
      - backend1
      - backend2
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  backend1:
    image: your-backend-image:latest
    environment:
      - PORT=3000
    restart: unless-stopped

  backend2:
    image: your-backend-image:latest
    environment:
      - PORT=3000
    restart: unless-stopped

volumes:
  redis-data:
```

Deploy the stack:

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f shadow-proxy

# Scale backend instances
docker-compose up -d --scale backend1=2 --scale backend2=2

# Stop all services
docker-compose down
```

### Production Docker Deployment

Create a production-specific compose file `docker-compose.prod.yml`:

```yaml
version: "3.8"

services:
  shadow-proxy:
    image: ghcr.io/techflowmb-creator/shadow-proxy:latest
    ports:
      - "80:8080"
      - "443:8443"
    environment:
      - NODE_ENV=production
      - PORT=8080
      - SSL_ENABLED=true
      - SSL_CERT_PATH=/ssl/cert.pem
      - SSL_KEY_PATH=/ssl/key.pem
      - BACKEND_URLS=http://backend1:3000,http://backend2:3000,http://backend3:3000
      - LOAD_BALANCER=least-connections
      - CACHE_ENABLED=true
      - CACHE_MAX_SIZE=50000
      - REDIS_ENABLED=true
      - REDIS_HOST=redis
      - RATE_LIMIT_IP_ENABLED=true
      - RATE_LIMIT_USER_ENABLED=true
      - RATE_LIMIT_STORAGE=redis
      - LOG_LEVEL=warn
      - LOG_FILE_PATH=/var/log/shadow-proxy/app.log
      - LOG_ROTATION_ENABLED=true
      - COMPRESSION_ENABLED=true
      - METRICS_ENABLED=true
      - WEBSOCKET_ENABLED=true
    volumes:
      - ./ssl:/ssl:ro
      - ./logs:/var/log/shadow-proxy
    depends_on:
      - redis
    restart: always
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.5"
          memory: 256M

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    restart: always
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

volumes:
  redis-data:
```

Deploy to production:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📚 API Documentation

### Endpoints

#### Proxy Endpoints

All traffic is proxied to configured backend servers with optional caching and rate limiting.

```
{method} /* -> Proxied to backend
```

#### Management Endpoints

##### Health Check

```http
GET /health
```

Returns the health status of the proxy and all backend servers.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "backends": {
    "total": 3,
    "healthy": 3,
    "unhealthy": 0
  },
  "system": {
    "memory": {
      "used": 128000000,
      "total": 512000000,
      "percentage": 25
    },
    "cpu": {
      "usage": 15.5
    }
  }
}
```

##### Metrics

```http
GET /metrics
```

Returns Prometheus-formatted metrics.

**Response:**

```
# HELP shadow_proxy_requests_total Total number of requests
# TYPE shadow_proxy_requests_total counter
shadow_proxy_requests_total{status="200",method="GET"} 1250
shadow_proxy_requests_total{status="404",method="GET"} 50
shadow_proxy_requests_total{status="500",method="POST"} 10

# HELP shadow_proxy_cache_hits_total Total cache hits
# TYPE shadow_proxy_cache_hits_total counter
shadow_proxy_cache_hits_total 850

# HELP shadow_proxy_cache_misses_total Total cache misses
# TYPE shadow_proxy_cache_misses_total counter
shadow_proxy_cache_misses_total 400

# HELP shadow_proxy_request_duration_seconds Request duration in seconds
# TYPE shadow_proxy_request_duration_seconds histogram
shadow_proxy_request_duration_seconds_bucket{le="0.1"} 1000
shadow_proxy_request_duration_seconds_bucket{le="0.5"} 1200
shadow_proxy_request_duration_seconds_bucket{le="1.0"} 1240
```

##### Cache Operations

**Invalidate Cache Entry:**

```http
POST /cache/invalidate
Content-Type: application/json

{
  "key": "/api/users"
}
```

**Invalidate All Cache:**

```http
POST /cache/invalidate-all
```

**Get Cache Statistics:**

```http
GET /cache/stats
```

**Response:**

```json
{
  "memoryCache": {
    "size": 1000,
    "maxSize": 10000,
    "hits": 850,
    "misses": 400,
    "hitRate": "68%"
  },
  "redisCache": {
    "connected": true,
    "keys": 5000,
    "hits": 1200,
    "misses": 300,
    "hitRate": "80%"
  }
}
```

##### System Information

```http
GET /system/info
```

Returns system information and current configuration.

**Response:**

```json
{
  "version": "1.0.0",
  "node": "v20.11.0",
  "platform": "linux",
  "arch": "x64",
  "uptime": 3600,
  "memory": {
    "rss": 134217728,
    "heapTotal": 67108864,
    "heapUsed": 33554432,
    "external": 8388608
  },
  "config": {
    "port": 8080,
    "cacheEnabled": true,
    "redisEnabled": true,
    "rateLimitEnabled": true,
    "loadBalancer": "round-robin"
  }
}
```

### Headers

#### Request Headers (Added by Proxy)

| Header                   | Description                    |
| ------------------------ | ------------------------------ |
| `X-Forwarded-For`        | Client IP address              |
| `X-Forwarded-Proto`      | Original protocol (http/https) |
| `X-Forwarded-Host`       | Original host header           |
| `X-Request-ID`           | Unique request identifier      |
| `X-Shadow-Proxy-Version` | Proxy version                  |

#### Response Headers (Added by Proxy)

| Header                   | Description                       |
| ------------------------ | --------------------------------- |
| `X-Cache-Status`         | Cache status: HIT / MISS / BYPASS |
| `X-Cache-TTL`            | Remaining cache TTL in seconds    |
| `X-Rate-Limit-Limit`     | Request limit for time window     |
| `X-Rate-Limit-Remaining` | Remaining requests in window      |
| `X-Rate-Limit-Reset`     | UNIX timestamp when limit resets  |
| `X-Response-Time`        | Response time in milliseconds     |

### Rate Limiting

When rate limiting is enabled, the following headers are included in every response:

```
X-Rate-Limit-Limit: 100
X-Rate-Limit-Remaining: 95
X-Rate-Limit-Reset: 1705312800
```

If the rate limit is exceeded, the proxy returns:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{
  "error": "Rate limit exceeded",
  "retryAfter": 900
}
```

### Custom API Keys

To use user-based rate limiting, include an API key in your requests:

```bash
# Using header
curl -H "X-API-Key: your-api-key" http://localhost:8080/api/data

# Using query parameter
curl http://localhost:8080/api/data?api_key=your-api-key
```

---

## 🔧 Development

### Scripts

```bash
# Start development server with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run tests
npm test

# Run linting
npm run lint

# Fix linting issues
npm run lint -- --fix

# Format code
npm run format

# Start production server
npm start
```

### Project Structure

```
shadow-proxy/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Main server class
│   ├── config.ts             # Configuration management
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── middleware/
│   │   ├── rate-limiter.ts   # Rate limiting middleware
│   │   ├── cache.ts          # Caching middleware
│   │   ├── logger.ts         # Logging middleware
│   │   └── security.ts       # Security headers middleware
│   ├── load-balancer/
│   │   ├── index.ts          # Load balancer factory
│   │   ├── round-robin.ts    # Round-robin algorithm
│   │   ├── least-connections.ts
│   │   ├── ip-hash.ts
│   │   └── weighted-round-robin.ts
│   ├── cache/
│   │   ├── memory-cache.ts   # In-memory LRU cache
│   │   ├── redis-cache.ts   # Redis cache implementation
│   │   └── cache-manager.ts # Cache orchestration
│   ├── utils/
│   │   ├── logger.ts        # Winston logger setup
│   │   ├── metrics.ts       # Prometheus metrics
│   │   └── health-check.ts  # Health check logic
│   └── api/
│       ├── health.ts        # Health check endpoint
│       ├── metrics.ts       # Metrics endpoint
│       └── cache-api.ts     # Cache management endpoints
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── logs/                    # Log files (gitignored)
├── dist/                    # Compiled JavaScript (gitignored)
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── tsconfig.json
├── package.json
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write tests for new features
- Update documentation as needed
- Follow the existing code style
- Ensure all tests pass before submitting PR

---

## 📄 License

MIT License

Copyright (c) 2024 Shadow Proxy Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## 🏆 Acknowledgments

- [http-proxy](https://github.com/http-party/node-http-proxy) - Core proxy functionality
- [ioredis](https://github.com/luin/ioredis) - Redis client
- [winston](https://github.com/winstonjs/winston) - Logging library
- [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible) - Rate limiting

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/techflowmb-creator/shadow-proxy/issues)
- **Discussions**: [GitHub Discussions](https://github.com/techflowmb-creator/shadow-proxy/discussions)
- **Email**: support@techflow.io

---

<p align="center">
  <strong>🖤 Built with precision for the Shadow Dominion 🖤</strong>
</p>
