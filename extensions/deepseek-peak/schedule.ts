/**
 * DeepSeek's scheduled V4 pricing windows, in UTC.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing/
 * The schedule is intentionally pure and has no dependency on pi or fetch.
 */

export const CUTOVER_UTC = Date.UTC(2026, 7, 16, 16, 0, 0)

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * HOUR_MS

const PEAK_WINDOWS_UTC = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 },
] as const

export type Phase = "peak" | "off"

export interface ScheduleSnapshot {
  readonly phase: Phase
  /** True when phase is the post-cutover schedule projection, not live billing. */
  readonly preCutover: boolean
  readonly nextBoundaryUtc: Date
  readonly nextLabel: "LIVE" | "PEAK" | "OFF-PEAK"
  readonly remainingMs: number
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function isPeakAt(timestamp: number): boolean {
  const date = new Date(timestamp)
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  return PEAK_WINDOWS_UTC.some(
    ({ startHour, endHour }) => hour >= startHour && hour < endHour,
  )
}

function nextLiveBoundary(timestamp: number): { at: number; label: "PEAK" | "OFF-PEAK" } {
  const dayStart = startOfUtcDay(timestamp)
  const candidates = PEAK_WINDOWS_UTC.flatMap(({ startHour, endHour }) => [
    { at: dayStart + startHour * HOUR_MS, label: "PEAK" as const },
    { at: dayStart + endHour * HOUR_MS, label: "OFF-PEAK" as const },
  ])
    .filter((candidate) => candidate.at > timestamp)
    .sort((a, b) => a.at - b.at)

  if (candidates.length > 0) return candidates[0]!
  return {
    at: dayStart + DAY_MS + PEAK_WINDOWS_UTC[0].startHour * HOUR_MS,
    label: "PEAK",
  }
}

/** Calculate the scheduled phase and next transition for a UTC instant. */
export function getScheduleSnapshot(now: Date = new Date()): ScheduleSnapshot {
  const timestamp = now.getTime()
  if (!Number.isFinite(timestamp)) throw new RangeError("now must be a valid Date")

  const phase: Phase = isPeakAt(timestamp) ? "peak" : "off"
  if (timestamp < CUTOVER_UTC) {
    return {
      phase,
      preCutover: true,
      nextBoundaryUtc: new Date(CUTOVER_UTC),
      nextLabel: "LIVE",
      remainingMs: CUTOVER_UTC - timestamp,
    }
  }

  const next = nextLiveBoundary(timestamp)
  return {
    phase,
    preCutover: false,
    nextBoundaryUtc: new Date(next.at),
    nextLabel: next.label,
    remainingMs: Math.max(0, next.at - timestamp),
  }
}

/** Format a non-negative duration as compact day/hour/minute text. */
export function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new RangeError("duration must be finite")
  const remaining = Math.max(0, Math.floor(milliseconds))
  const totalMinutes = Math.floor(remaining / MINUTE_MS)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
  return `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`
}

export function phaseLabel(phase: Phase): "PEAK" | "OFF-PEAK" {
  return phase === "peak" ? "PEAK" : "OFF-PEAK"
}

export function isPeak(now: Date = new Date()): boolean {
  const timestamp = now.getTime()
  if (!Number.isFinite(timestamp)) throw new RangeError("now must be a valid Date")
  return isPeakAt(timestamp)
}
