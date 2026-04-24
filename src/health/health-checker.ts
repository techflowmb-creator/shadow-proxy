import http from "http";
import https from "https";
import { EventEmitter } from "events";
import { TargetConfig, HealthCheckConfig } from "../config.js";
import { Logger } from "../utils/logger.js";

interface TargetHealth {
  target: TargetConfig;
  healthy: boolean;
  lastCheck: Date;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  failureCount: number;
  successCount: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  responseTime: number;
  checkInterval: number;
}

interface HealthCheckResult {
  healthy: boolean;
  timestamp: Date;
  targets: TargetHealth[];
}

interface HealthCheckerOptions {
  interval?: number;
  timeout?: number;
  failureThreshold?: number;
  successThreshold?: number;
  path?: string;
}

export class HealthChecker extends EventEmitter {
  private targets: TargetHealth[];
  private logger: Logger;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private defaultOptions: Required<HealthCheckerOptions>;

  constructor(targets: TargetConfig[], options: HealthCheckerOptions = {}) {
    super();
    this.logger = new Logger("HealthChecker");

    this.defaultOptions = {
      interval: 30000,
      timeout: 5000,
      failureThreshold: 3,
      successThreshold: 2,
      path: "/health",
      ...options,
    };

    // Initialize target health states
    this.targets = targets.map((target) => ({
      target,
      healthy: true, // Assume healthy initially
      lastCheck: new Date(),
      lastSuccess: null,
      lastFailure: null,
      failureCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      responseTime: 0,
      checkInterval:
        target.healthCheck?.interval || this.defaultOptions.interval,
    }));

    this.logger.info("Health checker initialized", {
      targetCount: targets.length,
      interval: this.defaultOptions.interval,
      timeout: this.defaultOptions.timeout,
    });
  }

  /**
   * Start health checking for all targets
   */
  public async start(): Promise<void> {
    this.logger.info("Starting health checks...");

    // Perform initial health checks
    await this.checkAllTargets();

    // Setup periodic health checks
    for (const targetHealth of this.targets) {
      this.scheduleHealthCheck(targetHealth);
    }

    this.logger.info("Health checks started for all targets");
  }

  /**
   * Stop health checking
   */
  public stop(): void {
    this.logger.info("Stopping health checks...");

    for (const [id, interval] of this.intervals) {
      clearTimeout(interval);
      this.intervals.delete(id);
    }

    this.logger.info("Health checks stopped");
  }

  /**
   * Schedule health check for a target
   */
  private scheduleHealthCheck(targetHealth: TargetHealth): void {
    const id = this.getTargetId(targetHealth.target);

    // Clear existing interval if any
    if (this.intervals.has(id)) {
      clearTimeout(this.intervals.get(id)!);
    }

    const check = async () => {
      await this.checkTarget(targetHealth);
      // Schedule next check
      this.scheduleHealthCheck(targetHealth);
    };

    const interval = setTimeout(check, targetHealth.checkInterval);
    this.intervals.set(id, interval);
  }

  /**
   * Check all targets immediately
   */
  public async checkAllTargets(): Promise<void> {
    const checks = this.targets.map((target) => this.checkTarget(target));
    await Promise.all(checks);
  }

  /**
   * Check a single target
   */
  private async checkTarget(targetHealth: TargetHealth): Promise<void> {
    const target = targetHealth.target;
    const startTime = Date.now();

    // Get health check configuration
    const healthConfig = target.healthCheck || {
      path: this.defaultOptions.path,
      timeout: this.defaultOptions.timeout,
      retries: this.defaultOptions.failureThreshold,
      interval: this.defaultOptions.interval,
    };

    const protocol = target.protocol || "http";
    const port = target.port || (protocol === "https" ? 443 : 80);

    try {
      const response = await this.makeHealthCheckRequest(
        protocol,
        target.host,
        port,
        healthConfig,
      );

      const responseTime = Date.now() - startTime;
      targetHealth.responseTime = responseTime;

      if (response.healthy) {
        this.handleTargetSuccess(targetHealth, responseTime);
      } else {
        this.handleTargetFailure(
          targetHealth,
          `Unhealthy status: ${response.statusCode}`,
        );
      }
    } catch (error) {
      this.handleTargetFailure(
        targetHealth,
        error instanceof Error ? error.message : String(error),
      );
    }

    targetHealth.lastCheck = new Date();
  }

  /**
   * Make HTTP health check request
   */
  private makeHealthCheckRequest(
    protocol: string,
    host: string,
    port: number,
    config: HealthCheckConfig,
  ): Promise<{ healthy: boolean; statusCode: number }> {
    return new Promise((resolve, reject) => {
      const path = config.path || this.defaultOptions.path;
      const timeout = config.timeout || this.defaultOptions.timeout;

      const options: http.RequestOptions = {
        hostname: host,
        port: port,
        path: path,
        method: "GET",
        timeout: timeout,
        headers: {
          "User-Agent": "ShadowHealthChecker/1.0",
          Accept: "application/json",
        },
      };

      const request =
        protocol === "https" ? https.request(options) : http.request(options);

      let completed = false;

      request.on("response", (response: http.IncomingMessage) => {
        if (completed) return;
        completed = true;

        const statusCode = response.statusCode || 0;
        // Consider 2xx and 3xx as healthy
        const healthy = statusCode >= 200 && statusCode < 400;

        resolve({ healthy, statusCode });
      });

      request.on("error", (error: Error) => {
        if (completed) return;
        completed = true;
        reject(error);
      });

      request.on("timeout", () => {
        if (completed) return;
        completed = true;
        request.destroy();
        reject(new Error("Health check timeout"));
      });

      request.setTimeout(timeout, () => {
        request.destroy();
      });

      request.end();
    });
  }

  /**
   * Handle target success
   */
  private handleTargetSuccess(
    targetHealth: TargetHealth,
    responseTime: number,
  ): void {
    const wasHealthy = targetHealth.healthy;
    const targetId = this.getTargetId(targetHealth.target);

    targetHealth.lastSuccess = new Date();
    targetHealth.successCount++;
    targetHealth.consecutiveSuccesses++;
    targetHealth.consecutiveFailures = 0;

    // Check if target should be marked healthy
    if (
      !wasHealthy &&
      targetHealth.consecutiveSuccesses >= this.defaultOptions.successThreshold
    ) {
      targetHealth.healthy = true;
      this.emit("targetHealthy", {
        target: targetHealth.target,
        responseTime,
        consecutiveSuccesses: targetHealth.consecutiveSuccesses,
      });
      this.logger.info("Target recovered", {
        target: targetId,
        responseTime,
      });
    }

    this.logger.debug("Health check passed", {
      target: targetId,
      responseTime,
      healthy: targetHealth.healthy,
    });
  }

  /**
   * Handle target failure
   */
  private handleTargetFailure(targetHealth: TargetHealth, error: string): void {
    const wasHealthy = targetHealth.healthy;
    const targetId = this.getTargetId(targetHealth.target);

    targetHealth.lastFailure = new Date();
    targetHealth.failureCount++;
    targetHealth.consecutiveFailures++;
    targetHealth.consecutiveSuccesses = 0;

    // Check if target should be marked unhealthy
    if (
      wasHealthy &&
      targetHealth.consecutiveFailures >= this.defaultOptions.failureThreshold
    ) {
      targetHealth.healthy = false;
      this.emit("targetUnhealthy", {
        target: targetHealth.target,
        error,
        consecutiveFailures: targetHealth.consecutiveFailures,
      });
      this.logger.warn("Target marked unhealthy", {
        target: targetId,
        error,
        consecutiveFailures: targetHealth.consecutiveFailures,
      });
    }

    this.logger.debug("Health check failed", {
      target: targetId,
      error,
      healthy: targetHealth.healthy,
      consecutiveFailures: targetHealth.consecutiveFailures,
    });
  }

  /**
   * Get health status for all targets
   */
  public getHealth(): HealthCheckResult {
    const healthyTargets = this.targets.filter((t) => t.healthy);

    return {
      healthy: healthyTargets.length > 0,
      timestamp: new Date(),
      targets: [...this.targets],
    };
  }

  /**
   * Get health status for a specific target
   */
  public getTargetHealth(target: TargetConfig): TargetHealth | null {
    return (
      this.targets.find(
        (t) => t.target.host === target.host && t.target.port === target.port,
      ) || null
    );
  }

  /**
   * Check if a target is healthy
   */
  public isHealthy(target: TargetConfig): boolean {
    const health = this.getTargetHealth(target);
    return health?.healthy ?? false;
  }

  /**
   * Get number of healthy targets
   */
  public getHealthyCount(): number {
    return this.targets.filter((t) => t.healthy).length;
  }

  /**
   * Get number of unhealthy targets
   */
  public getUnhealthyCount(): number {
    return this.targets.filter((t) => !t.healthy).length;
  }

  /**
   * Force a target to be marked as healthy (admin override)
   */
  public forceHealthy(target: TargetConfig): void {
    const targetHealth = this.getTargetHealth(target);
    if (targetHealth) {
      const wasHealthy = targetHealth.healthy;
      targetHealth.healthy = true;
      targetHealth.consecutiveSuccesses = this.defaultOptions.successThreshold;
      targetHealth.consecutiveFailures = 0;

      if (!wasHealthy) {
        this.logger.info("Target manually marked healthy", {
          target: this.getTargetId(target),
        });
        this.emit("targetHealthy", { target, manual: true });
      }
    }
  }

  /**
   * Force a target to be marked as unhealthy (admin override)
   */
  public forceUnhealthy(target: TargetConfig, reason?: string): void {
    const targetHealth = this.getTargetHealth(target);
    if (targetHealth) {
      const wasHealthy = targetHealth.healthy;
      targetHealth.healthy = false;
      targetHealth.consecutiveFailures = this.defaultOptions.failureThreshold;
      targetHealth.consecutiveSuccesses = 0;

      if (wasHealthy) {
        this.logger.info("Target manually marked unhealthy", {
          target: this.getTargetId(target),
          reason: reason || "Manual override",
        });
        this.emit("targetUnhealthy", { target, manual: true, reason });
      }
    }
  }

  /**
   * Add a new target to health checking
   */
  public addTarget(target: TargetConfig): void {
    const exists = this.targets.some(
      (t) => t.target.host === target.host && t.target.port === target.port,
    );

    if (exists) {
      this.logger.warn("Target already exists in health checker", {
        target: this.getTargetId(target),
      });
      return;
    }

    const targetHealth: TargetHealth = {
      target,
      healthy: true,
      lastCheck: new Date(),
      lastSuccess: null,
      lastFailure: null,
      failureCount: 0,
      successCount: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      responseTime: 0,
      checkInterval:
        target.healthCheck?.interval || this.defaultOptions.interval,
    };

    this.targets.push(targetHealth);
    this.scheduleHealthCheck(targetHealth);

    this.logger.info("Target added to health checker", {
      target: this.getTargetId(target),
    });
  }

  /**
   * Remove a target from health checking
   */
  public removeTarget(target: TargetConfig): void {
    const index = this.targets.findIndex(
      (t) => t.target.host === target.host && t.target.port === target.port,
    );

    if (index === -1) {
      this.logger.warn("Target not found in health checker", {
        target: this.getTargetId(target),
      });
      return;
    }

    // Clear interval
    const id = this.getTargetId(target);
    if (this.intervals.has(id)) {
      clearTimeout(this.intervals.get(id)!);
      this.intervals.delete(id);
    }

    this.targets.splice(index, 1);

    this.logger.info("Target removed from health checker", {
      target: id,
    });
  }

  /**
   * Get detailed health statistics
   */
  public getStats(): {
    totalTargets: number;
    healthyTargets: number;
    unhealthyTargets: number;
    averageResponseTime: number;
    targets: Array<{
      id: string;
      healthy: boolean;
      responseTime: number;
      lastCheck: Date;
      lastSuccess: Date | null;
      failureCount: number;
    }>;
  } {
    const healthyTargets = this.targets.filter((t) => t.healthy);
    const avgResponseTime =
      healthyTargets.length > 0
        ? healthyTargets.reduce((sum, t) => sum + t.responseTime, 0) /
          healthyTargets.length
        : 0;

    return {
      totalTargets: this.targets.length,
      healthyTargets: healthyTargets.length,
      unhealthyTargets: this.targets.length - healthyTargets.length,
      averageResponseTime: Math.round(avgResponseTime),
      targets: this.targets.map((t) => ({
        id: this.getTargetId(t.target),
        healthy: t.healthy,
        responseTime: t.responseTime,
        lastCheck: t.lastCheck,
        lastSuccess: t.lastSuccess,
        failureCount: t.failureCount,
      })),
    };
  }

  /**
   * Update health check options
   */
  public updateOptions(options: Partial<HealthCheckerOptions>): void {
    Object.assign(this.defaultOptions, options);
    this.logger.info("Health checker options updated", options);

    // Restart health checks with new options
    this.stop();
    this.start();
  }

  /**
   * Get target ID string
   */
  private getTargetId(target: TargetConfig): string {
    return `${target.protocol || "http"}://${target.host}:${target.port}`;
  }

  /**
   * Dispose of the health checker
   */
  public dispose(): void {
    this.stop();
    this.targets = [];
    this.removeAllListeners();
    this.logger.info("Health checker disposed");
  }
}

export default HealthChecker;
