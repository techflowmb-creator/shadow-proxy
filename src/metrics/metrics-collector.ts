import { EventEmitter } from "events"
import { Request, Response, NextFunction } from "express"
import { Logger } from "../utils/logger.js"

interface MetricCounter {
  value: number
  lastUpdated: number
}

interface MetricHistogram {
  values: number[]
  buckets: number[]
}

interface MetricsData {
  // Request metrics
  totalRequests: MetricCounter
  activeRequests: MetricCounter
  requestsByMethod: Map<string, MetricCounter>
  requestsByStatus: Map<string, MetricCounter>
  requestsByPath: Map<string, MetricCounter>

  // Latency metrics
  responseTime: MetricHistogram
  latencyP50: number
  latencyP95: number
  latencyP99: number

  // Throughput metrics
  bytesIn: MetricCounter
  bytesOut: MetricCounter

  // Error metrics
  totalErrors: MetricCounter
  errorsByType: Map<string, MetricCounter>

  // Timing
  startTime: number
  lastResetTime: number
}

interface MetricsSnapshot {
  timestamp: string
  uptime: number
  requests: {
    total: number
    active: number
    rate: number
    byMethod: Record<string, number>
    byStatus: Record<string, number>
    byPath: Record<string, number>
  }
  latency: {
    avg: number
    min: number
    max: number
    p50: number
    p95: number
    p99: number
  }
  throughput: {
    bytesIn: number
    bytesOut: number
    bytesInPerSecond: number
    bytesOutPerSecond: number
  }
  errors: {
    total: number
    rate: number
    byType: Record<string, number>
  }
  system: {
    memory: NodeJS.MemoryUsage
    cpu?: number
  }
}

export class MetricsCollector extends EventEmitter {
  private logger: Logger
  private metrics: MetricsData
  private histogramBuckets: number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
  private maxHistogramValues: number = 10000
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.logger = new Logger("MetricsCollector")
    this.metrics = this.initializeMetrics()
    this.startCleanupTimer()

    this.logger.info("Metrics collector initialized")
  }

  /**
   * Initialize metrics data structure
   */
  private initializeMetrics(): MetricsData {
    const now = Date.now()
    return {
      totalRequests: { value: 0, lastUpdated: now },
      activeRequests: { value: 0, lastUpdated: now },
      requestsByMethod: new Map(),
      requestsByStatus: new Map(),
      requestsByPath: new Map(),
      responseTime: { values: [], buckets: this.histogramBuckets },
      latencyP50: 0,
      latencyP95: 0,
      latencyP99: 0,
      bytesIn: { value: 0, lastUpdated: now },
      bytesOut: { value: 0, lastUpdated: now },
      totalErrors: { value: 0, lastUpdated: now },
      errorsByType: new Map(),
      startTime: now,
      lastResetTime: now,
    }
  }

  /**
   * Express middleware to collect request metrics
   */
  public middleware(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now()
    const requestId = (req.headers["x-request-id"] as string) || this.generateRequestId()

    // Increment active requests
    this.metrics.activeRequests.value++
    this.metrics.activeRequests.lastUpdated = Date.now()

    // Track request method
    this.incrementCounter(this.metrics.requestsByMethod, req.method)

    // Track request path
    const path = this.sanitizePath(req.path)
    this.incrementCounter(this.metrics.requestsByPath, path)

    // Track request size
    const contentLength = parseInt(req.headers["content-length"] || "0")
    if (contentLength > 0) {
      this.metrics.bytesIn.value += contentLength
      this.metrics.bytesIn.lastUpdated = Date.now()
    }

    // Wrap response.end to capture metrics
    const originalEnd = res.end.bind(res)
    res.end = (...args: any[]) => {
      const duration = Date.now() - startTime

      // Decrement active requests
      this.metrics.activeRequests.value = Math.max(0, this.metrics.activeRequests.value - 1)
      this.metrics.activeRequests.lastUpdated = Date.now()

      // Increment total requests
      this.metrics.totalRequests.value++
      this.metrics.totalRequests.lastUpdated = Date.now()

      // Track status code
      this.incrementCounter(this.metrics.requestsByStatus, res.statusCode.toString())

      // Track response time
      this.addResponseTime(duration)

      // Track response size
      const responseLength = parseInt((res.getHeader("content-length") as string) || "0")
      if (responseLength > 0) {
        this.metrics.bytesOut.value += responseLength
        this.metrics.bytesOut.lastUpdated = Date.now()
      }

      // Track errors
      if (res.statusCode >= 400) {
        this.incrementCounter(this.metrics.errorsByType, res.statusCode.toString())
        this.metrics.totalErrors.value++
        this.metrics.totalErrors.lastUpdated = Date.now()
      }

      // Emit metrics event for real-time monitoring
      this.emit("request", {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString(),
      })

      // Log slow requests
      if (duration > 1000) {
        this.logger.warn("Slow request detected", {
          requestId,
          method: req.method,
          path: req.path,
          duration,
          statusCode: res.statusCode,
        })
      }

      originalEnd(...args)
    }

    next()
  }

  /**
   * Increment a counter in a Map
   */
  private incrementCounter(map: Map<string, MetricCounter>, key: string): void {
    const existing = map.get(key)
    if (existing) {
      existing.value++
      existing.lastUpdated = Date.now()
    } else {
      map.set(key, { value: 1, lastUpdated: Date.now() })
    }
  }

  /**
   * Add response time to histogram
   */
  private addResponseTime(duration: number): void {
    this.metrics.responseTime.values.push(duration)

    // Keep histogram size bounded
    if (this.metrics.responseTime.values.length > this.maxHistogramValues) {
      this.metrics.responseTime.values = this.metrics.responseTime.values.slice(-this.maxHistogramValues)
    }

    // Calculate percentiles
    const sorted = [...this.metrics.responseTime.values].sort((a, b) => a - b)
    this.metrics.latencyP50 = this.calculatePercentile(sorted, 0.5)
    this.metrics.latencyP95 = this.calculatePercentile(sorted, 0.95)
    this.metrics.latencyP99 = this.calculatePercentile(sorted, 0.99)
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil(sorted.length * percentile) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
  }

  /**
   * Sanitize path for tracking
   */
  private sanitizePath(path: string): string {
    // Remove query strings and normalize
    const cleanPath = path.split("?")[0]

    // Replace dynamic segments with placeholders
    return cleanPath
      .replace(/\/[^/]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
      .replace(/\/\d+/g, "/:id")
      .replace(/\/[-a-zA-Z0-9]{20,}/g, "/:hash") // Likely hashes/keys
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Track a custom metric
   */
  public trackMetric(name: string, value: number, labels?: Record<string, string>): void {
    this.emit("custom", { name, value, labels, timestamp: Date.now() })
    this.logger.debug("Custom metric tracked", { name, value, labels })
  }

  /**
   * Track an error
   */
  public trackError(errorType: string, message?: string): void {
    this.incrementCounter(this.metrics.errorsByType, errorType)
    this.metrics.totalErrors.value++
    this.metrics.totalErrors.lastUpdated = Date.now()

    this.emit("error", { type: errorType, message, timestamp: Date.now() })
    this.logger.debug("Error tracked", { type: errorType, message })
  }

  /**
   * Get metrics snapshot
   */
  public getMetrics(): MetricsSnapshot {
    const now = Date.now()
    const uptime = now - this.metrics.startTime
    const timeSinceReset = now - this.metrics.lastResetTime

    // Calculate rates
    const windowMs = Math.max(timeSinceReset, 60000) // At least 1 minute
    const requestsPerSecond = (this.metrics.totalRequests.value / windowMs) * 1000
    const errorsPerSecond = (this.metrics.totalErrors.value / windowMs) * 1000

    const sortedLatencies = [...this.metrics.responseTime.values].sort((a, b) => a - b)

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000), // Convert to seconds
      requests: {
        total: this.metrics.totalRequests.value,
        active: this.metrics.activeRequests.value,
        rate: Math.round(requestsPerSecond * 100) / 100,
        byMethod: this.mapToRecord(this.metrics.requestsByMethod),
        byStatus: this.mapToRecord(this.metrics.requestsByStatus),
        byPath: this.mapToRecord(this.metrics.requestsByPath),
      },
      latency: {
        avg:
          sortedLatencies.length > 0
            ? Math.round(sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length)
            : 0,
        min: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
        max: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
        p50: this.metrics.latencyP50,
        p95: this.metrics.latencyP95,
        p99: this.metrics.latencyP99,
      },
      throughput: {
        bytesIn: this.metrics.bytesIn.value,
        bytesOut: this.metrics.bytesOut.value,
        bytesInPerSecond: Math.round((this.metrics.bytesIn.value / uptime) * 1000),
        bytesOutPerSecond: Math.round((this.metrics.bytesOut.value / uptime) * 1000),
      },
      errors: {
        total: this.metrics.totalErrors.value,
        rate: Math.round(errorsPerSecond * 100) / 100,
        byType: this.mapToRecord(this.metrics.errorsByType),
      },
      system: {
        memory: process.memoryUsage(),
      },
    }
  }

  /**
   * Convert Map to Record
   */
  private mapToRecord(map: Map<string, MetricCounter>): Record<string, number> {
    const record: Record<string, number> = {}
    for (const [key, value] of map) {
      record[key] = value.value
    }
    return record
  }

  /**
   * Get metrics as Prometheus format
   */
  public getPrometheusMetrics(): string {
    const metrics = this.getMetrics()
    const lines: string[] = []

    lines.push("# HELP shadow_requests_total Total number of requests")
    lines.push("# TYPE shadow_requests_total counter")
    lines.push(`shadow_requests_total ${metrics.requests.total}`)

    lines.push("# HELP shadow_active_requests Current active requests")
    lines.push("# TYPE shadow_active_requests gauge")
    lines.push(`shadow_active_requests ${metrics.requests.active}`)

    lines.push("# HELP shadow_request_duration_seconds Request duration")
    lines.push("# TYPE shadow_request_duration_seconds summary")
    lines.push(`shadow_request_duration_seconds{quantile="0.5"} ${metrics.latency.p50 / 1000}`)
    lines.push(`shadow_request_duration_seconds{quantile="0.95"} ${metrics.latency.p95 / 1000}`)
    lines.push(`shadow_request_duration_seconds{quantile="0.99"} ${metrics.latency.p99 / 1000}`)

    lines.push("# HELP shadow_errors_total Total number of errors")
    lines.push("# TYPE shadow_errors_total counter")
    lines.push(`shadow_errors_total ${metrics.errors.total}`)

    lines.push("# HELP shadow_bytes_total Total bytes transferred")
    lines.push("# TYPE shadow_bytes_total counter")
    lines.push(`shadow_bytes_total{direction="in"} ${metrics.throughput.bytesIn}`)
    lines.push(`shadow_bytes_total{direction="out"} ${metrics.throughput.bytesOut}`)

    return lines.join("\n")
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    const oldMetrics = this.metrics
    this.metrics = this.initializeMetrics()
    this.metrics.startTime = oldMetrics.startTime // Preserve start time

    this.logger.info("Metrics reset")
    this.emit("reset", { timestamp: Date.now() })
  }

  /**
   * Start cleanup timer to prevent unbounded growth
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(
      () => {
        // Clean up old counters (older than 24 hours)
        const cutoff = Date.now() - 24 * 60 * 60 * 1000

        this.cleanupOldCounters(this.metrics.requestsByMethod, cutoff)
        this.cleanupOldCounters(this.metrics.requestsByStatus, cutoff)
        this.cleanupOldCounters(this.metrics.requestsByPath, cutoff)
        this.cleanupOldCounters(this.metrics.errorsByType, cutoff)
      },
      60 * 60 * 1000,
    ) // Run every hour
  }

  /**
   * Clean up old counters
   */
  private cleanupOldCounters(map: Map<string, MetricCounter>, cutoff: number): void {
    for (const [key, value] of map) {
      if (value.lastUpdated < cutoff) {
        map.delete(key)
      }
    }
  }

  /**
   * Get histogram distribution
   */
  public getLatencyDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {}
    const values = this.metrics.responseTime.values

    for (const bucket of this.histogramBuckets) {
      distribution[`le_${bucket}ms`] = values.filter((v) => v <= bucket).length
    }

    distribution.total = values.length
    return distribution
  }

  /**
   * Dispose of the metrics collector
   */
  public dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.removeAllListeners()
    this.logger.info("Metrics collector disposed")
  }
}

export default MetricsCollector
