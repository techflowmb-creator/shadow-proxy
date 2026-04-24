import winston from "winston"
import { config } from "../config.js"

const { combine, timestamp, json, printf, colorize, align } = winston.format

const prettyFormat = printf(({ level, message, timestamp, service, ...metadata }) => {
  const metaStr = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : ""
  return `[${timestamp}] [${service || "Shadow"}] ${level}: ${message} ${metaStr}`
})

const jsonFormat = combine(timestamp(), json())

const createLogger = (serviceName: string): winston.Logger => {
  const formats: winston.format.Format[] =
    config.logging.format === "pretty" ? [colorize(), timestamp(), align(), prettyFormat] : [timestamp(), json()]

  const transports: winston.transport[] = []

  if (config.logging.output === "stdout" || config.logging.output === "console") {
    transports.push(
      new winston.transports.Console({
        format: combine(...formats),
      }),
    )
  }

  if (config.logging.output !== "stdout" && config.logging.output !== "console") {
    transports.push(
      new winston.transports.File({
        filename: config.logging.output,
        format: config.logging.format === "json" ? jsonFormat : combine(...formats),
      }),
    )
  }

  return winston.createLogger({
    level: config.logging.level,
    defaultMeta: { service: serviceName },
    transports,
    exitOnError: false,
  })
}

export class Logger {
  private logger: winston.Logger

  constructor(service: string) {
    this.logger = createLogger(service)
  }

  info(message: string, meta?: Record<string, any>): void {
    this.logger.info(message, meta)
  }

  error(message: string, error?: any): void {
    const meta = error instanceof Error ? { error: error.message, stack: error.stack } : { error }
    this.logger.error(message, meta)
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.logger.warn(message, meta)
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.logger.debug(message, meta)
  }

  log(level: string, message: string, meta?: Record<string, any>): void {
    this.logger.log(level, message, meta)
  }
}

export default Logger
