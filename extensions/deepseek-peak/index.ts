import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import {
  checkDeepSeekHealth,
  type HealthResult,
  type ResolvedProviderAuth,
} from "./deepseek-health.ts"
import {
  formatCountdown,
  getScheduleSnapshot,
  phaseLabel,
  type ScheduleSnapshot,
} from "./schedule.ts"

const STATUS_KEY = "deepseek-peak"
const HEALTH_INTERVAL_MS = 5 * 60 * 1000
const MINUTE_MS = 60 * 1000

type Timer = ReturnType<typeof setTimeout>

export default function (pi: ExtensionAPI): void {
  let generation = 0
  let scheduleTimer: Timer | undefined
  let healthTimer: Timer | undefined
  let health: HealthResult | undefined
  let activeHealth: { generation: number; controller: AbortController } | undefined

  function clearTimer(timer: Timer | undefined): undefined {
    if (timer !== undefined) clearTimeout(timer)
    return undefined
  }

  function renderStatus(ctx: ExtensionContext, now = new Date()): void {
    const snapshot = getScheduleSnapshot(now)
    ctx.ui.setStatus(STATUS_KEY, formatStatus(ctx, snapshot, health))
  }

  function formatStatus(
    ctx: ExtensionContext,
    snapshot: ScheduleSnapshot,
    healthResult: HealthResult | undefined,
  ): string {
    const theme = ctx.ui.theme
    const phase = phaseLabel(snapshot.phase)
    const phaseColor = snapshot.preCutover
      ? "warning"
      : snapshot.phase === "peak" ? "error" : "success"
    const phaseText = theme.fg(phaseColor, `● ${phase}`)
    const prefix = theme.fg("muted", "DS ") + phaseText
    const target = snapshot.preCutover
      ? `${formatCountdown(snapshot.remainingMs)} → LIVE`
      : `${formatCountdown(snapshot.remainingMs)} → ${snapshot.nextLabel}`
    const cutover = snapshot.preCutover ? theme.fg("warning", " · PRE-CUTOVER") : ""
    const warning = healthResult?.degraded ? theme.fg("warning", " · ⚠") : ""
    return `${prefix}${cutover}${theme.fg("muted", ` · ${target}`)}${warning}`
  }

  function scheduleNextRender(ctx: ExtensionContext, expectedGeneration: number): void {
    scheduleTimer = clearTimer(scheduleTimer)
    if (expectedGeneration !== generation) return

    const now = Date.now()
    // Wake on the next minute boundary, with a small cushion for timer
    // scheduling jitter. The callback recomputes from Date.now(), so clock
    // changes and cutover/phase boundaries remain correct.
    const nextMinute = now - (now % MINUTE_MS) + MINUTE_MS + 25
    const delay = Math.max(25, nextMinute - now)
    scheduleTimer = setTimeout(() => {
      if (expectedGeneration !== generation) return
      renderStatus(ctx)
      scheduleNextRender(ctx, expectedGeneration)
    }, delay)
  }

  function scheduleNextHealth(ctx: ExtensionContext, expectedGeneration: number): void {
    healthTimer = clearTimer(healthTimer)
    if (expectedGeneration !== generation) return
    healthTimer = setTimeout(() => {
      if (expectedGeneration === generation) void refreshHealth(ctx, expectedGeneration)
    }, HEALTH_INTERVAL_MS)
  }

  async function refreshHealth(ctx: ExtensionContext, expectedGeneration: number): Promise<void> {
    if (expectedGeneration !== generation || activeHealth !== undefined) return

    const controller = new AbortController()
    const operation = { generation: expectedGeneration, controller }
    activeHealth = operation
    try {
      let resolved: ResolvedProviderAuth | undefined
      try {
        resolved = await ctx.modelRegistry.getProviderAuth("deepseek")
      } catch {
        if (expectedGeneration === generation) {
          health = { status: "auth-error", degraded: true }
          renderStatus(ctx)
        }
        return
      }

      if (expectedGeneration !== generation) return
      const result = await checkDeepSeekHealth(resolved, { signal: controller.signal })
      if (expectedGeneration === generation) {
        health = result
        renderStatus(ctx)
      }
    } catch {
      // The helper is defensive, but an extension-owned failure should never
      // interrupt the agent. Keep the schedule visible with a compact warning.
      if (expectedGeneration === generation) {
        health = { status: "network-error", degraded: true }
        renderStatus(ctx)
      }
    } finally {
      if (activeHealth === operation) activeHealth = undefined
      if (expectedGeneration === generation) scheduleNextHealth(ctx, expectedGeneration)
    }
  }

  function stopSession(ctx: ExtensionContext): void {
    generation += 1
    scheduleTimer = clearTimer(scheduleTimer)
    healthTimer = clearTimer(healthTimer)
    activeHealth?.controller.abort()
    activeHealth = undefined
    health = undefined
    ctx.ui.setStatus(STATUS_KEY, undefined)
  }

  pi.on("session_start", (_event, ctx) => {
    stopSession(ctx)
    const sessionGeneration = generation
    renderStatus(ctx)
    scheduleNextRender(ctx, sessionGeneration)
    void refreshHealth(ctx, sessionGeneration)
  })

  pi.on("session_shutdown", (_event, ctx) => {
    stopSession(ctx)
  })
}
