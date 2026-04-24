import express from "express"
import cors from "cors"
import helmet from "helmet"
import compression from "compression"
import http from "http"
import https from "https"
import fs from "fs"
import { ServerConfig } from "./config.js"
import { Logger } from "./utils/logger.js"
import { CacheManager } from "./cache/cache-manager.js"
import { LoadBalancer } from "./load-balancer/load-balancer.js"
import { RateLimiter } from "./rate-limiter/rate-limiter.js"
import { ProxyHandler } from "./proxy/proxy-handler.js"
import { MetricsCollector } from "./metrics/metrics-collector.js"
import { HealthChecker } from "./health/health-checker.js"

export class ProxyServer {
  private app: express.Application
  private server: http.Server | https.Server | null = null
  private config: ServerConfig
  private logger: Logger
  private cacheManager: CacheManager
  private loadBalancer: LoadBalancer
  private rateLimiter: RateLimiter
  private proxyHandler: ProxyHandler
  private metricsCollector: MetricsCollector
  private healthChecker: HealthChecker

  constructor(config: ServerConfig) {
    this.config = config
    this.logger = new Logger("ProxyServer")
    this.app = express()

    // Initialize components
    this.cacheManager = new CacheManager(config.cache)
    this.loadBalancer = new LoadBalancer(config.targets, config.loadBalancer)
    this.rateLimiter = new RateLimiter(config.rateLimit)
    this.proxyHandler = new ProxyHandler(config, this.cacheManager, this.loadBalancer)
    this.metricsCollector = new MetricsCollector()
    this.healthChecker = new HealthChecker(config.targets)

    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    this.app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    )

    this.app.use(
      cors({
        origin: "*",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      }),
    )

    this.app.use(compression())
    this.app.use(express.json())
    this.app.use(this.metricsCollector.middleware.bind(this.metricsCollector))

    if (this.config.rateLimit.enabled) {
      this.app.use(this.rateLimiter.middleware.bind(this.rateLimiter))
    }
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      const health = this.healthChecker.getHealth()
      res.status(health.healthy ? 200 : 503).json({
        status: health.healthy ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        targets: health.targets,
      })
    })

    // Ready check endpoint
    this.app.get("/ready", (req, res) => {
      const health = this.healthChecker.getHealth()
      res.status(health.healthy ? 200 : 503).json({
        ready: health.healthy,
        timestamp: new Date().toISOString(),
      })
    })

    // Metrics endpoint
    this.app.get("/metrics", (req, res) => {
      res.json(this.metricsCollector.getMetrics())
    })

    // Stats endpoint
    this.app.get("/stats", (req, res) => {
      res.json({
        cache: this.cacheManager.getStats(),
        loadBalancer: this.loadBalancer.getStats(),
        rateLimiter: this.rateLimiter.getStats(),
        metrics: this.metricsCollector.getMetrics(),
      })
    })

    // Config endpoint (without sensitive data)
    this.app.get("/config", (req, res) => {
      res.json({
        port: this.config.port,
        host: this.config.host,
        ssl: { enabled: this.config.ssl.enabled },
        cache: { enabled: this.config.cache.enabled },
        rateLimit: { enabled: this.config.rateLimit.enabled },
        websocket: { enabled: this.config.websocket.enabled },
        targets: this.config.targets.map((t) => ({ host: t.host, port: t.port, weight: t.weight })),
      })
    })

    // Proxy all other requests
    this.app.all("*", this.proxyHandler.handle.bind(this.proxyHandler))
  }

  public async start(): Promise<void> {
    // Start health checker
    await this.healthChecker.start()

    if (this.config.ssl.enabled && this.config.ssl.cert && this.config.ssl.key) {
      const options = {
        cert: fs.readFileSync(this.config.ssl.cert),
        key: fs.readFileSync(this.config.ssl.key),
      }

      this.server = https.createServer(options, this.app)
      this.logger.info(`Starting HTTPS server on ${this.config.host}:${this.config.port}`)
    } else {
      this.server = http.createServer(this.app)
      this.logger.info(`Starting HTTP server on ${this.config.host}:${this.config.port}`)
    }

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.logger.info("🖤 Shadow Proxy Server started successfully")
        resolve()
      })

      this.server!.on("error", (error) => {
        this.logger.error("Failed to start server:", error)
        reject(error)
      })

      if (this.config.websocket.enabled) {
        this.proxyHandler.setupWebSocket(this.server!)
      }
    })
  }

  public async shutdown(): Promise<void> {
    this.logger.info("Shutting down proxy server...")

    this.healthChecker.stop()
    this.cacheManager.close()

    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.logger.info("Server shut down")
          resolve()
        })
      })
    }
  }

  public getServer(): http.Server | https.Server | null {
    return this.server
  }
}

export default ProxyServer
