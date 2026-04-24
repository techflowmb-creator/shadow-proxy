import { Request, Response, NextFunction } from "express";
import {
  RateLimiterRes,
  RateLimiterRedis,
  RateLimiterMemory,
} from "rate-limiter-flexible";
import { Redis } from "ioredis";
import { RateLimitConfig } from "../config.js";
import { Logger } from "../utils/logger.js";

interface RateLimiterStats {
  totalRequests: number;
  limitedRequests: number;
  activeKeys: number;
  redisConnected: boolean;
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Date;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private logger: Logger;
  private limiterRedis: RateLimiterRedis | null = null;
  private limiterMemory: RateLimiterMemory;
  private redis: Redis | null = null;
  private totalRequests: number = 0;
  private limitedRequests: number = 0;
  private activeKeys: Set<string> = new Set();

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.logger = new Logger("RateLimiter");

    // Initialize in-memory rate limiter (always available as fallback)
    this.limiterMemory = new RateLimiterMemory({
      keyPrefix: config.keyPrefix,
      points: config.maxRequests,
      duration: Math.floor(config.windowMs / 1000), // Convert to seconds
    });

    this.logger.info("Rate limiter initialized", {
      enabled: config.enabled,
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      keyPrefix: config.keyPrefix,
    });
  }

  /**
   * Initialize Redis rate limiter
   */
  public async initRedis(redisUrl: string, password?: string): Promise<void> {
    try {
      this.redis = new Redis(redisUrl, {
        password,
        retryStrategy: (times: number) => {
          if (times > 3) {
            this.logger.error(
              "Redis connection failed after 3 retries, using memory fallback",
            );
            return null;
          }
          return Math.min(times * 50, 2000);
        },
      });

      await new Promise<void>((resolve, reject) => {
        this.redis!.once("connect", () => {
          this.logger.info("Redis connected for rate limiting");
          resolve();
        });

        this.redis!.once("error", (error: Error) => {
          this.logger.error("Redis connection error:", error);
          reject(error);
        });

        // Timeout fallback
        setTimeout(() => {
          resolve();
        }, 5000);
      });

      // Initialize Redis rate limiter
      this.limiterRedis = new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: this.config.keyPrefix,
        points: this.config.maxRequests,
        duration: Math.floor(this.config.windowMs / 1000),
      });

      this.logger.info("Redis rate limiter initialized");
    } catch (error) {
      this.logger.error(
        "Failed to initialize Redis rate limiter, using memory fallback:",
        error,
      );
      this.limiterRedis = null;
      if (this.redis) {
        this.redis.disconnect();
        this.redis = null;
      }
    }
  }

  /**
   * Express middleware for rate limiting
   */
  public async middleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!this.config.enabled) {
      next();
      return;
    }

    try {
      const key = this.generateKey(req);
      const limiter = this.limiterRedis || this.limiterMemory;

      this.activeKeys.add(key);
      this.totalRequests++;

      const rateLimiterRes = await limiter.consume(key, 1);

      // Set rate limit headers
      this.setRateLimitHeaders(res, rateLimiterRes, this.config.maxRequests);

      this.logger.debug("Request allowed", {
        key: key.substring(0, 20),
        remaining: rateLimiterRes.remainingPoints,
      });

      next();
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        this.limitedRequests++;

        // Set rate limit headers
        this.setRateLimitHeaders(res, error, this.config.maxRequests);

        this.logger.warn("Rate limit exceeded", {
          key: this.generateKey(req).substring(0, 20),
          retryAfter: Math.round(error.msBeforeNext / 1000),
        });

        res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil(error.msBeforeNext / 1000),
        });
      } else {
        this.logger.error("Rate limiter error:", error);
        next(error);
      }
    }
  }

  /**
   * Generate rate limit key from request
   * Supports IP-based and token-based limiting
   */
  private generateKey(req: Request): string {
    // Check for token-based limiting (Authorization header or API key)
    const authHeader = req.headers.authorization;
    const apiKey = req.headers["x-api-key"] as string;

    if (authHeader) {
      // Use bearer token or API key
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : authHeader;
      return `${this.config.keyPrefix}token:${this.hashKey(token)}`;
    }

    if (apiKey) {
      return `${this.config.keyPrefix}apikey:${this.hashKey(apiKey)}`;
    }

    // Fall back to IP-based limiting
    const clientIp = this.getClientIp(req);
    return `${this.config.keyPrefix}ip:${clientIp}`;
  }

  /**
   * Hash a key for security
   */
  private hashKey(key: string): string {
    // Simple hash for demonstration - in production use proper hashing
    return Buffer.from(key).toString("base64").substring(0, 16);
  }

  /**
   * Get client IP from request
   */
  private getClientIp(req: Request): string {
    // Check for forwarded IP (behind proxy)
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      const ips = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(",")[0];
      return ips.trim();
    }

    // Check for other proxy headers
    const realIp = req.headers["x-real-ip"];
    if (realIp && typeof realIp === "string") {
      return realIp;
    }

    // Fall back to connection remote address
    return req.socket?.remoteAddress || req.ip || "unknown";
  }

  /**
   * Set rate limit headers on response
   */
  private setRateLimitHeaders(
    res: Response,
    rateLimiterRes: RateLimiterRes,
    maxRequests: number,
  ): void {
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader(
      "X-RateLimit-Remaining",
      Math.max(0, rateLimiterRes.remainingPoints).toString(),
    );
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
    );

    // Retry-After header for limited requests
    if (rateLimiterRes.remainingPoints <= 0) {
      res.setHeader(
        "Retry-After",
        Math.ceil(rateLimiterRes.msBeforeNext / 1000).toString(),
      );
    }
  }

  /**
   * Check if a specific key would be rate limited
   */
  public async checkLimit(
    key: string,
  ): Promise<{ allowed: boolean; info: RateLimitInfo | null }> {
    try {
      const limiter = this.limiterRedis || this.limiterMemory;
      const res = await limiter.get(key);

      if (res === null) {
        // Key doesn't exist, full quota available
        return {
          allowed: true,
          info: {
            limit: this.config.maxRequests,
            remaining: this.config.maxRequests,
            resetTime: new Date(Date.now() + this.config.windowMs),
          },
        };
      }

      const remaining = Math.max(
        0,
        this.config.maxRequests - res.consumedPoints,
      );

      return {
        allowed: remaining > 0,
        info: {
          limit: this.config.maxRequests,
          remaining,
          resetTime: new Date(Date.now() + res.msBeforeNext),
        },
      };
    } catch (error) {
      this.logger.error("Error checking rate limit:", error);
      return { allowed: true, info: null };
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  public async resetKey(key: string): Promise<void> {
    try {
      const limiter = this.limiterRedis || this.limiterMemory;
      await limiter.delete(key);
      this.activeKeys.delete(key);

      this.logger.info("Rate limit reset", { key: key.substring(0, 20) });
    } catch (error) {
      this.logger.error("Error resetting rate limit:", error);
    }
  }

  /**
   * Get current rate limiter statistics
   */
  public getStats(): RateLimiterStats {
    return {
      totalRequests: this.totalRequests,
      limitedRequests: this.limitedRequests,
      activeKeys: this.activeKeys.size,
      redisConnected: this.redis?.status === "ready" || false,
    };
  }

  /**
   * Check if using Redis backing
   */
  public isUsingRedis(): boolean {
    return this.limiterRedis !== null && this.redis?.status === "ready";
  }

  /**
   * Update rate limit configuration
   */
  public updateConfig(config: Partial<RateLimitConfig>): void {
    if (config.maxRequests !== undefined) {
      this.config.maxRequests = config.maxRequests;
    }
    if (config.windowMs !== undefined) {
      this.config.windowMs = config.windowMs;
    }
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }

    // Reinitialize memory limiter with new settings
    this.limiterMemory = new RateLimiterMemory({
      keyPrefix: this.config.keyPrefix,
      points: this.config.maxRequests,
      duration: Math.floor(this.config.windowMs / 1000),
    });

    // Reinitialize Redis limiter if connected
    if (this.redis && this.redis.status === "ready") {
      this.limiterRedis = new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: this.config.keyPrefix,
        points: this.config.maxRequests,
        duration: Math.floor(this.config.windowMs / 1000),
      });
    }

    this.logger.info("Rate limit configuration updated", {
      maxRequests: this.config.maxRequests,
      windowMs: this.config.windowMs,
      enabled: this.config.enabled,
    });
  }

  /**
   * Clear all rate limit data
   */
  public async clear(): Promise<void> {
    try {
      this.activeKeys.clear();
      this.totalRequests = 0;
      this.limitedRequests = 0;

      // Clear Redis keys if connected
      if (this.redis && this.redis.status === "ready") {
        const keys = await this.redis.keys(`${this.config.keyPrefix}*`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      this.logger.info("Rate limit data cleared");
    } catch (error) {
      this.logger.error("Error clearing rate limit data:", error);
    }
  }

  /**
   * Close Redis connection
   */
  public close(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
      this.limiterRedis = null;
      this.logger.info("Rate limiter Redis connection closed");
    }
  }
}

export default RateLimiter;
