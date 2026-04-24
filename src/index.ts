#!/usr/bin/env node
import { ProxyServer } from "./server.js"
import { Logger } from "./utils/logger.js"
import { config } from "./config.js"

const logger = new Logger("Main")

async function main() {
  try {
    const server = new ProxyServer(config)

    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully...")
      await server.shutdown()
      process.exit(0)
    })

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully...")
      await server.shutdown()
      process.exit(0)
    })

    await server.start()
    logger.info(`🖤 Shadow Proxy Server running on port ${config.port}`)
    logger.info(`📊 Health check: http://localhost:${config.port}/health`)
    logger.info(`📈 Metrics: http://localhost:${config.port}/metrics`)
  } catch (error) {
    logger.error("Failed to start server:", error)
    process.exit(1)
  }
}

main()
