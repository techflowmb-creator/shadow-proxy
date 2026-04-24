import { LRUCache } from "lru-cache";
import { Redis } from "ioredis";
import crypto from "crypto";
import { CacheConfig } from "../config.js";
import { Logger } from "../utils/logger.js";

interface CacheEntry {
  body: Buffer;
  headers: Record<string, string>;
  statusCode: number;
  timestamp: number;
}

export class CacheManager {
  private config: CacheConfig;
  private logger: Logger;
  private lruCache: LRUCache<string, CacheEntry>;
  private redis: Redis | null = null;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config: CacheConfig) {
    this.config = config;
    this.logger = new Logger("CacheManager");

    this.lruCache = new LRUCache<string, CacheEntry>({
      max: config.maxSize,
      ttl: config.ttl * 1000,
      updateAgeOnGet: true,
    });

    if (config.redis?.enabled) {
      this.initRedis();
    }

    this.logger.info("Cache manager initialized", {
      enabled: config.enabled,
      maxSize: config.maxSize,
      ttl: config.ttl,
    });
  }

  private initRedis(): void {
    const redisConfig = this.config.redis!;

    this.redis = new Redis(redisConfig.url, {
      password: redisConfig.password,
      retryStrategy: (times: number) => {
        if (times > 3) {
          this.logger.error("Redis connection failed after 3 retries");
          return null;
        }
        return Math.min(times * 50, 2000);
      },
    });

    this.redis.on("connect", () => {
      this.logger.info("Redis cache connected");
    });

    this.redis.on("error", (error: Error) => {
      this.logger.error("Redis error:", error);
    });
  }

  public generateKey(method: string, url: string, body?: string): string {
    const input = `${method}:${url}:${body || ""}`;
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  public async get(key: string): Promise<CacheEntry | null> {
    if (!this.config.enabled) return null;

    // Check in-memory cache first
    const inMemory = this.lruCache.get(key);
    if (inMemory) {
      this.hits++;
      this.logger.debug("Cache hit (in-memory)", { key: key.substring(0, 8) });
      return inMemory;
    }

    // Check Redis if available
    if (this.redis) {
      try {
        const redisData = await this.redis.get(`shadow:cache:${key}`);
        if (redisData) {
          const entry: CacheEntry = JSON.parse(redisData);
          // Store in local cache for faster access
          this.lruCache.set(key, entry);
          this.hits++;
          this.logger.debug("Cache hit (redis)", { key: key.substring(0, 8) });
          return entry;
        }
      } catch (error) {
        this.logger.error("Redis cache get error:", error);
      }
    }

    this.misses++;
    this.logger.debug("Cache miss", { key: key.substring(0, 8) });
    return null;
  }

  public async set(key: string, entry: CacheEntry): Promise<void> {
    if (!this.config.enabled) return;

    // Store in local cache
    this.lruCache.set(key, entry);

    // Store in Redis if available
    if (this.redis) {
      try {
        await this.redis.setex(
          `shadow:cache:${key}`,
          this.config.ttl,
          JSON.stringify(entry),
        );
      } catch (error) {
        this.logger.error("Redis cache set error:", error);
      }
    }

    this.logger.debug("Cache stored", { key: key.substring(0, 8) });
  }

  public async delete(key: string): Promise<void> {
    this.lruCache.delete(key);

    if (this.redis) {
      try {
        await this.redis.del(`shadow:cache:${key}`);
      } catch (error) {
        this.logger.error("Redis cache delete error:", error);
      }
    }
  }

  public async clear(): Promise<void> {
    this.lruCache.clear();
    this.hits = 0;
    this.misses = 0;

    if (this.redis) {
      try {
        const keys = await this.redis.keys("shadow:cache:*");
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch (error) {
        this.logger.error("Redis cache clear error:", error);
      }
    }

    this.logger.info("Cache cleared");
  }

  public isCacheableMethod(method: string): boolean {
    return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  }

  public isCacheableStatus(statusCode: number): boolean {
    return statusCode >= 200 && statusCode < 400;
  }

  public getStats(): {
    size: number;
    hitRate: number;
    hits: number;
    misses: number;
    maxSize: number;
    ttl: number;
    redisConnected: boolean;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.lruCache.size,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0,
      hits: this.hits,
      misses: this.misses,
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
      redisConnected: this.redis?.status === "ready" || false,
    };
  }

  public close(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.logger.info("Cache manager closed");
    }
  }
}

export default CacheManager;
