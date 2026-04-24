import dotenv from "dotenv";

dotenv.config();

export interface ServerConfig {
  port: number;
  host: string;
  ssl: {
    enabled: boolean;
    cert?: string;
    key?: string;
  };
  targets: TargetConfig[];
  cache: CacheConfig;
  rateLimit: RateLimitConfig;
  loadBalancer: LoadBalancerConfig;
  logging: LogConfig;
  websocket: WebSocketConfig;
}

export interface TargetConfig {
  host: string;
  port: number;
  protocol: "http" | "https";
  weight?: number;
  healthCheck?: HealthCheckConfig;
}

export interface HealthCheckConfig {
  path: string;
  interval: number;
  timeout: number;
  retries: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize: number;
  redis?: {
    enabled: boolean;
    url: string;
    password?: string;
  };
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface LoadBalancerConfig {
  algorithm: "round-robin" | "least-connections" | "ip-hash" | "random";
  healthCheckInterval: number;
}

export interface LogConfig {
  level: string;
  format: "json" | "pretty";
  output: string;
}

export interface WebSocketConfig {
  enabled: boolean;
  heartbeatInterval: number;
}

function parseTargets(): TargetConfig[] {
  const targetsEnv = process.env.PROXY_TARGETS;
  if (!targetsEnv) {
    return [
      {
        host: "localhost",
        port: 3000,
        protocol: "http",
        weight: 1,
      },
    ];
  }

  try {
    return JSON.parse(targetsEnv);
  } catch {
    return targetsEnv.split(",").map((target) => {
      const [host, port] = target.trim().split(":");
      return {
        host: host || "localhost",
        port: parseInt(port) || 80,
        protocol: "http" as const,
        weight: 1,
      };
    });
  }
}

export const config: ServerConfig = {
  port: parseInt(process.env.PROXY_PORT || "8080"),
  host: process.env.PROXY_HOST || "0.0.0.0",
  ssl: {
    enabled: process.env.SSL_ENABLED === "true",
    cert: process.env.SSL_CERT_PATH,
    key: process.env.SSL_KEY_PATH,
  },
  targets: parseTargets(),
  cache: {
    enabled: process.env.CACHE_ENABLED !== "false",
    ttl: parseInt(process.env.CACHE_TTL || "300"),
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || "1000"),
    redis: {
      enabled: process.env.REDIS_ENABLED === "true",
      url: process.env.REDIS_URL || "redis://localhost:6379",
      password: process.env.REDIS_PASSWORD,
    },
  },
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"),
    keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX || "shadow:ratelimit:",
  },
  loadBalancer: {
    algorithm: (process.env.LB_ALGORITHM as any) || "round-robin",
    healthCheckInterval: parseInt(
      process.env.LB_HEALTH_CHECK_INTERVAL || "30000",
    ),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: (process.env.LOG_FORMAT as any) || "json",
    output: process.env.LOG_OUTPUT || "stdout",
  },
  websocket: {
    enabled: process.env.WS_ENABLED !== "false",
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || "30000"),
  },
};

export default config;
