import { createHash } from "crypto"
import { EventEmitter } from "events"
import { TargetConfig, LoadBalancerConfig } from "../config.js"
import { Logger } from "../utils/logger.js"

export type LoadBalancingAlgorithm = "round-robin" | "least-connections" | "ip-hash" | "random"

interface TargetState {
  target: TargetConfig
  connectionCount: number
  healthy: boolean
  lastCheck: Date
  failureCount: number
}

interface LoadBalancerStats {
  totalConnections: number
  activeConnections: number
  healthyTargets: number
  unhealthyTargets: number
  targetDistribution: Record<string, number>
}

export class LoadBalancer extends EventEmitter {
  private config: LoadBalancerConfig
  private targets: TargetState[]
  private logger: Logger
  private currentIndex: number = 0
  private totalConnections: number = 0

  constructor(targets: TargetConfig[], config: LoadBalancerConfig) {
    super()
    this.config = config
    this.logger = new Logger("LoadBalancer")

    // Initialize targets with connection tracking
    this.targets = targets.map((target) => ({
      target,
      connectionCount: 0,
      healthy: true,
      lastCheck: new Date(),
      failureCount: 0,
    }))

    this.logger.info("Load balancer initialized", {
      algorithm: config.algorithm,
      targetCount: targets.length,
    })
  }

  /**
   * Select a target based on the configured algorithm
   */
  public selectTarget(clientIp?: string): TargetConfig | null {
    const healthyTargets = this.getHealthyTargets()

    if (healthyTargets.length === 0) {
      this.logger.warn("No healthy targets available")
      return null
    }

    let selected: TargetState

    switch (this.config.algorithm) {
      case "round-robin":
        selected = this.roundRobin(healthyTargets)
        break
      case "least-connections":
        selected = this.leastConnections(healthyTargets)
        break
      case "ip-hash":
        selected = this.ipHash(healthyTargets, clientIp)
        break
      case "random":
        selected = this.random(healthyTargets)
        break
      default:
        selected = this.roundRobin(healthyTargets)
    }

    // Increment connection count for the selected target
    selected.connectionCount++
    this.totalConnections++

    this.logger.debug("Target selected", {
      algorithm: this.config.algorithm,
      target: `${selected.target.host}:${selected.target.port}`,
      connections: selected.connectionCount,
    })

    this.emit("targetSelected", selected.target)
    return selected.target
  }

  /**
   * Round-robin algorithm - cycles through targets in order
   */
  private roundRobin(healthyTargets: TargetState[]): TargetState {
    // Weighted round-robin support
    const weightedTargets: TargetState[] = []

    for (const target of healthyTargets) {
      const weight = target.target.weight || 1
      for (let i = 0; i < weight; i++) {
        weightedTargets.push(target)
      }
    }

    const selected = weightedTargets[this.currentIndex % weightedTargets.length]
    this.currentIndex = (this.currentIndex + 1) % weightedTargets.length

    return selected
  }

  /**
   * Least connections algorithm - selects target with fewest active connections
   */
  private leastConnections(healthyTargets: TargetState[]): TargetState {
    // Sort by connection count and weight
    const sorted = healthyTargets.sort((a, b) => {
      const aWeight = a.target.weight || 1
      const bWeight = b.target.weight || 1

      // Calculate adjusted connection count (connections / weight)
      const aAdjusted = a.connectionCount / aWeight
      const bAdjusted = b.connectionCount / bWeight

      return aAdjusted - bAdjusted
    })

    return sorted[0]
  }

  /**
   * IP hash algorithm - consistently maps client IP to same target
   */
  private ipHash(healthyTargets: TargetState[], clientIp: string = "unknown"): TargetState {
    // Create hash from client IP
    const hash = parseInt(createHash("md5").update(clientIp).digest("hex").substring(0, 8), 16)

    const index = hash % healthyTargets.length
    return healthyTargets[index]
  }

  /**
   * Random algorithm - selects random target
   */
  private random(healthyTargets: TargetState[]): TargetState {
    // Weighted random support
    const totalWeight = healthyTargets.reduce((sum, t) => sum + (t.target.weight || 1), 0)
    let random = Math.random() * totalWeight

    for (const targetState of healthyTargets) {
      const weight = targetState.target.weight || 1
      random -= weight
      if (random <= 0) {
        return targetState
      }
    }

    return healthyTargets[0]
  }

  /**
   * Release a connection from a target
   */
  public releaseConnection(target: TargetConfig): void {
    const targetState = this.targets.find((t) => t.target.host === target.host && t.target.port === target.port)

    if (targetState && targetState.connectionCount > 0) {
      targetState.connectionCount--
      this.totalConnections--

      this.logger.debug("Connection released", {
        target: `${target.host}:${target.port}`,
        remainingConnections: targetState.connectionCount,
      })
    }
  }

  /**
   * Get all healthy targets
   */
  public getHealthyTargets(): TargetState[] {
    return this.targets.filter((t) => t.healthy)
  }

  /**
   * Get all unhealthy targets
   */
  public getUnhealthyTargets(): TargetState[] {
    return this.targets.filter((t) => !t.healthy)
  }

  /**
   * Update target health status
   */
  public updateTargetHealth(target: TargetConfig, healthy: boolean): void {
    const targetState = this.targets.find((t) => t.target.host === target.host && t.target.port === target.port)

    if (!targetState) {
      this.logger.warn("Attempted to update health for unknown target", {
        host: target.host,
        port: target.port,
      })
      return
    }

    const wasHealthy = targetState.healthy
    targetState.healthy = healthy
    targetState.lastCheck = new Date()

    if (healthy) {
      targetState.failureCount = 0
    } else {
      targetState.failureCount++
    }

    if (wasHealthy !== healthy) {
      this.logger.info(`Target ${healthy ? "recovered" : "failed"}`, {
        target: `${target.host}:${target.port}`,
        failureCount: targetState.failureCount,
      })

      this.emit(healthy ? "targetRecovered" : "targetFailed", target)
    }
  }

  /**
   * Get target by host and port
   */
  public getTarget(host: string, port: number): TargetConfig | null {
    const targetState = this.targets.find((t) => t.target.host === host && t.target.port === port)
    return targetState?.target || null
  }

  /**
   * Add a new target dynamically
   */
  public addTarget(target: TargetConfig): void {
    const exists = this.targets.some((t) => t.target.host === target.host && t.target.port === target.port)

    if (exists) {
      this.logger.warn("Target already exists", { host: target.host, port: target.port })
      return
    }

    this.targets.push({
      target,
      connectionCount: 0,
      healthy: true,
      lastCheck: new Date(),
      failureCount: 0,
    })

    this.logger.info("Target added", { host: target.host, port: target.port })
    this.emit("targetAdded", target)
  }

  /**
   * Remove a target dynamically
   */
  public removeTarget(target: TargetConfig): void {
    const index = this.targets.findIndex((t) => t.target.host === target.host && t.target.port === target.port)

    if (index === -1) {
      this.logger.warn("Target not found for removal", { host: target.host, port: target.port })
      return
    }

    const removed = this.targets.splice(index, 1)[0]

    // Adjust total connections
    this.totalConnections -= removed.connectionCount

    this.logger.info("Target removed", { host: target.host, port: target.port })
    this.emit("targetRemoved", target)
  }

  /**
   * Get current load balancer statistics
   */
  public getStats(): LoadBalancerStats {
    const healthyTargets = this.getHealthyTargets()
    const unhealthyTargets = this.getUnhealthyTargets()

    const targetDistribution: Record<string, number> = {}

    for (const target of this.targets) {
      const key = `${target.target.host}:${target.target.port}`
      targetDistribution[key] = target.connectionCount
    }

    return {
      totalConnections: this.totalConnections,
      activeConnections: this.totalConnections,
      healthyTargets: healthyTargets.length,
      unhealthyTargets: unhealthyTargets.length,
      targetDistribution,
    }
  }

  /**
   * Get detailed target information
   */
  public getTargetDetails(): Array<{
    host: string
    port: number
    healthy: boolean
    connectionCount: number
    failureCount: number
    lastCheck: Date
    weight?: number
  }> {
    return this.targets.map((t) => ({
      host: t.target.host,
      port: t.target.port,
      healthy: t.healthy,
      connectionCount: t.connectionCount,
      failureCount: t.failureCount,
      lastCheck: t.lastCheck,
      weight: t.target.weight,
    }))
  }

  /**
   * Reset all connection counts
   */
  public resetConnectionCounts(): void {
    for (const target of this.targets) {
      target.connectionCount = 0
    }
    this.totalConnections = 0
    this.currentIndex = 0

    this.logger.debug("Connection counts reset")
  }

  /**
   * Get the total number of targets
   */
  public getTargetCount(): number {
    return this.targets.length
  }

  /**
   * Get the number of healthy targets
   */
  public getHealthyTargetCount(): number {
    return this.getHealthyTargets().length
  }

  /**
   * Change the load balancing algorithm
   */
  public setAlgorithm(algorithm: LoadBalancingAlgorithm): void {
    const oldAlgorithm = this.config.algorithm
    this.config.algorithm = algorithm
    this.currentIndex = 0 // Reset for consistency

    this.logger.info("Algorithm changed", { from: oldAlgorithm, to: algorithm })
    this.emit("algorithmChanged", { from: oldAlgorithm, to: algorithm })
  }

  /**
   * Dispose of the load balancer
   */
  public dispose(): void {
    this.targets = []
    this.totalConnections = 0
    this.currentIndex = 0
    this.removeAllListeners()

    this.logger.info("Load balancer disposed")
  }
}

export default LoadBalancer
