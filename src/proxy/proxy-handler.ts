import http from "http";
import https from "https";
import httpProxy from "http-proxy";
import { Request, Response, NextFunction } from "express";
import WebSocket, { WebSocketServer } from "ws";
import { ServerConfig, TargetConfig } from "../config.js";
import { Logger } from "../utils/logger.js";
import { CacheManager } from "../cache/cache-manager.js";
import { LoadBalancer } from "../load-balancer/load-balancer.js";

interface RequestTransform {
  headers?: Record<string, string | string[]>;
  body?: any;
  path?: string;
  query?: Record<string, string>;
}

interface ResponseTransform {
  headers?: Record<string, string | string[]>;
  statusCode?: number;
  body?: any;
}

// Removed unused CachedResponse interface

export class ProxyHandler {
  private proxy: httpProxy;
  private config: ServerConfig;
  private logger: Logger;
  private cacheManager: CacheManager;
  private loadBalancer: LoadBalancer;
  private activeConnections: Map<
    string,
    { target: TargetConfig; startTime: number }
  > = new Map();
  private requestTransforms: Map<
    string,
    (req: Request) => RequestTransform | Promise<RequestTransform>
  > = new Map();
  private responseTransforms: Map<
    string,
    (
      res: Response,
      body: Buffer,
    ) => ResponseTransform | Promise<ResponseTransform>
  > = new Map();
  private wsServer: WebSocketServer | null = null;

  constructor(
    config: ServerConfig,
    cacheManager: CacheManager,
    loadBalancer: LoadBalancer,
  ) {
    this.config = config;
    this.logger = new Logger("ProxyHandler");
    this.cacheManager = cacheManager;
    this.loadBalancer = loadBalancer;

    // Initialize the HTTP proxy
    this.proxy = httpProxy.createProxyServer({
      changeOrigin: true,
      xfwd: true,
      secure: false, // Allow self-signed certificates
      followRedirects: true,
    });

    this.setupProxyEvents();
    this.logger.info("Proxy handler initialized");
  }

  /**
   * Setup proxy event handlers
   */
  private setupProxyEvents(): void {
    // Handle proxy errors
    this.proxy.on("error", (err: Error, req: any, res: any) => {
      this.logger.error("Proxy error:", err);

      if (res && !res.headersSent) {
        res.statusCode = 502;
        res.json({
          error: "Bad Gateway",
          message: "The proxy server encountered an error.",
        });
      }

      // Release connection from load balancer
      this.releaseConnection(req);
    });

    // Handle proxy response
    this.proxy.on(
      "proxyRes",
      (proxyRes: http.IncomingMessage, req: any, res: any) => {
        const requestId =
          req.headers["x-request-id"] || this.generateRequestId();

        this.logger.debug("Proxy response received", {
          requestId,
          statusCode: proxyRes.statusCode,
          target: req.headers["x-proxy-target"],
        });

        // Apply response transformation if configured
        this.applyResponseTransform(proxyRes, req, res);

        // Cache successful responses
        this.cacheResponse(proxyRes, req, res);

        // Set response headers
        proxyRes.headers["x-request-id"] = requestId;
        proxyRes.headers["x-shadow-proxy"] = "1.0.0";
      },
    );

    // Handle proxy request
    this.proxy.on(
      "proxyReq",
      (_proxyReq: http.ClientRequest, req: any, _res: any) => {
        const requestId =
          req.headers["x-request-id"] || this.generateRequestId();
        req.headers["x-request-id"] = requestId;

        this.logger.debug("Proxy request started", {
          requestId,
          method: req.method,
          url: req.url,
          target: req.headers["x-proxy-target"],
        });
      },
    );
  }

  /**
   * Main proxy handler middleware
   */
  public async handle(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const requestId = this.generateRequestId();
      req.headers["x-request-id"] = requestId;

      this.logger.info("Incoming request", {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip,
      });

      // Check cache first for GET requests
      if (
        this.config.cache.enabled &&
        this.cacheManager.isCacheableMethod(req.method)
      ) {
        const cached = await this.checkCache(req, res);
        if (cached) {
          return;
        }
      }

      // Select target using load balancer
      const clientIp = req.ip || "unknown";
      const target = this.loadBalancer.selectTarget(clientIp);

      if (!target) {
        this.logger.error("No healthy targets available");
        res.status(503).json({
          error: "Service Unavailable",
          message: "No healthy upstream targets available.",
        });
        return;
      }

      // Track connection
      const connectionId = `${requestId}-${Date.now()}`;
      this.activeConnections.set(connectionId, {
        target,
        startTime: Date.now(),
      });

      // Build target URL
      const targetUrl = this.buildTargetUrl(target, req.url);
      req.headers["x-proxy-target"] = targetUrl;

      // Apply request transformation
      await this.applyRequestTransform(req);

      // Proxy the request
      this.proxy.web(
        req,
        res,
        {
          target: targetUrl,
          selfHandleResponse: false,
        },
        (error) => {
          this.logger.error("Proxy error:", error);
          res.status(502).json({
            error: "Bad Gateway",
            message: "Failed to proxy request to upstream server.",
          });
        },
      );

      // Clean up connection when response finishes
      res.on("finish", () => {
        this.releaseConnection({ targetUrl: connectionId } as any);
      });
    } catch (error) {
      this.logger.error("Proxy handler error:", error);
      next(error);
    }
  }

  /**
   * Check cache for request
   */
  private async checkCache(req: Request, res: Response): Promise<boolean> {
    try {
      const cacheKey = this.cacheManager.generateKey(
        req.method,
        req.originalUrl,
        JSON.stringify(req.body),
      );

      const cached = await this.cacheManager.get(cacheKey);

      if (cached) {
        this.logger.debug("Cache hit, serving from cache", {
          url: req.url,
          key: cacheKey.substring(0, 8),
        });

        // Set cached headers
        Object.entries(cached.headers).forEach(([key, value]) => {
          if (value) res.setHeader(key, value);
        });

        res.setHeader("X-Cache", "HIT");
        res.setHeader("X-Cache-Key", cacheKey.substring(0, 8));
        res.statusCode = cached.statusCode;
        res.end(cached.body);

        return true;
      }

      res.setHeader("X-Cache", "MISS");
      return false;
    } catch (error) {
      this.logger.error("Cache check error:", error);
      return false;
    }
  }

  /**
   * Cache the response
   */
  private async cacheResponse(
    proxyRes: http.IncomingMessage,
    req: any,
    res: any,
  ): Promise<void> {
    // Only cache successful responses for cacheable methods
    if (!this.config.cache.enabled) return;
    if (!this.cacheManager.isCacheableMethod(req.method)) return;
    if (!this.cacheManager.isCacheableStatus(proxyRes.statusCode || 0)) return;

    try {
      const chunks: Buffer[] = [];

      // Collect response chunks
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      res.write = function (chunk: any) {
        if (chunk && Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
        return originalWrite(chunk);
      };

      res.end = async (chunk?: any) => {
        if (chunk && Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }

        // Cache the complete response
        const body = Buffer.concat(chunks);
        const cacheKey = this.cacheManager.generateKey(
          req.method,
          req.originalUrl,
          JSON.stringify(req.body),
        );

        const headers: Record<string, string> = {};
        Object.entries(proxyRes.headers).forEach(([key, value]) => {
          if (typeof value === "string") {
            headers[key] = value;
          } else if (Array.isArray(value)) {
            headers[key] = value.join(", ");
          }
        });

        await this.cacheManager.set(cacheKey, {
          body,
          headers,
          statusCode: proxyRes.statusCode || 200,
          timestamp: Date.now(),
        });

        originalEnd(chunk);
      };
    } catch (error) {
      this.logger.error("Cache response error:", error);
    }
  }

  /**
   * Build target URL
   */
  private buildTargetUrl(target: TargetConfig, path: string = "/"): string {
    const protocol = target.protocol || "http";
    return `${protocol}://${target.host}:${target.port}${path}`;
  }

  /**
   * Apply request transformation
   */
  private async applyRequestTransform(req: Request): Promise<void> {
    for (const [pattern, transform] of this.requestTransforms) {
      if (this.matchesPattern(req.url, pattern)) {
        try {
          const result = await transform(req);

          // Apply transformations
          if (result.headers) {
            Object.assign(req.headers, result.headers);
          }
          if (result.body && req.body) {
            Object.assign(req.body, result.body);
          }
          if (result.path) {
            req.url = result.path;
          }
          if (result.query) {
            const url = new URL(req.url, "http://localhost");
            Object.entries(result.query).forEach(([key, value]) => {
              url.searchParams.set(key, value);
            });
            req.url = url.pathname + url.search;
          }
        } catch (error) {
          this.logger.error("Request transform error:", error);
        }
      }
    }
  }

  /**
   * Apply response transformation
   */
  private async applyResponseTransform(
    _proxyRes: http.IncomingMessage,
    req: any,
    _res: any,
  ): Promise<void> {
    for (const [pattern, _transform] of this.responseTransforms) {
      if (this.matchesPattern(req.url, pattern)) {
        try {
          // Note: Response transformation after receiving body requires buffering
          // This is a placeholder - actual implementation would buffer the response
          this.logger.debug("Response transform applied", { pattern });
        } catch (error) {
          this.logger.error("Response transform error:", error);
        }
      }
    }
  }

  /**
   * Check if URL matches pattern
   */
  private matchesPattern(url: string, pattern: string): boolean {
    // Simple pattern matching - can be extended to use regex
    if (pattern === "*") return true;
    if (pattern.startsWith("/")) {
      return url.startsWith(pattern);
    }
    return url.includes(pattern);
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `shadow-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Release connection tracking
   */
  private releaseConnection(req: any): void {
    const connectionId = req?.headers?.["x-connection-id"];
    if (connectionId && this.activeConnections.has(connectionId)) {
      const connection = this.activeConnections.get(connectionId)!;
      this.loadBalancer.releaseConnection(connection.target);
      this.activeConnections.delete(connectionId);

      const duration = Date.now() - connection.startTime;
      this.logger.debug("Connection released", { connectionId, duration });
    }
  }

  /**
   * Setup WebSocket handling
   */
  public setupWebSocket(server: http.Server | https.Server): void {
    if (!this.config.websocket.enabled) return;

    this.wsServer = new WebSocketServer({
      server,
      path: "/",
    });

    this.wsServer.on(
      "connection",
      (ws: WebSocket, req: http.IncomingMessage) => {
        this.logger.info("WebSocket connection established", {
          url: req.url,
          ip: req.socket.remoteAddress,
        });

        // Select target for WebSocket
        const clientIp = req.socket.remoteAddress || "unknown";
        const target = this.loadBalancer.selectTarget(clientIp);

        if (!target) {
          this.logger.error("No healthy targets for WebSocket");
          ws.close(1011, "No healthy upstream targets");
          return;
        }

        // Proxy WebSocket connection
        const targetUrl = this.buildTargetUrl(target, req.url || "/");

        this.proxy.ws(req, ws as any, req.headers as any, {
          target: targetUrl,
          changeOrigin: true,
        });

        // Setup heartbeat
        const heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, this.config.websocket.heartbeatInterval);

        ws.on("close", () => {
          clearInterval(heartbeat);
          this.loadBalancer.releaseConnection(target);
          this.logger.info("WebSocket connection closed");
        });

        ws.on("error", (error: Error) => {
          this.logger.error("WebSocket error:", error);
          clearInterval(heartbeat);
        });
      },
    );

    this.logger.info("WebSocket support enabled");
  }

  /**
   * Register a request transformer
   */
  public registerRequestTransform(
    pattern: string,
    transform: (req: Request) => RequestTransform | Promise<RequestTransform>,
  ): void {
    this.requestTransforms.set(pattern, transform);
    this.logger.info("Request transformer registered", { pattern });
  }

  /**
   * Register a response transformer
   */
  public registerResponseTransform(
    pattern: string,
    transform: (
      res: Response,
      body: Buffer,
    ) => ResponseTransform | Promise<ResponseTransform>,
  ): void {
    this.responseTransforms.set(pattern, transform);
    this.logger.info("Response transformer registered", { pattern });
  }

  /**
   * Get active connections count
   */
  public getActiveConnections(): number {
    return this.activeConnections.size;
  }

  /**
   * Get proxy statistics
   */
  public getStats(): {
    activeConnections: number;
    requestTransforms: number;
    responseTransforms: number;
    websocketEnabled: boolean;
  } {
    return {
      activeConnections: this.activeConnections.size,
      requestTransforms: this.requestTransforms.size,
      responseTransforms: this.responseTransforms.size,
      websocketEnabled: this.config.websocket.enabled,
    };
  }

  /**
   * Close the proxy handler
   */
  public close(): void {
    // Release all active connections
    for (const [_id, connection] of this.activeConnections) {
      this.loadBalancer.releaseConnection(connection.target);
    }
    this.activeConnections.clear();

    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    this.logger.info("Proxy handler closed");
  }
}

export default ProxyHandler;
