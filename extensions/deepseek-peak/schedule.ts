/**
 * DeepSeek's scheduled V4 pricing windows, in UTC.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing/
 * Weekends (Saturday/Sunday Beijing time) bill off-peak all day from
 * WEEKEND_RULE_UTC onward. The schedule is intentionally pure and has no
 * dependency on pi or fetch.
 */

export const CUTOVER_UTC = Date.UTC(2026, 7, 16, 16, 0, 0)

/**
 * Weekend rule effective instant: 00:00 Sunday 2026-08-23 Beijing time.
 * From this moment, Saturdays and Sundays (Beijing time) have no peak windows
 * and bill at the off-peak rate all day.
 */
export const WEEKEND_RULE_UTC = Date.UTC(2026, 7, 22, 16, 0, 0)

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Beijing is UTC+8 with no DST. */
const BEIJING_OFFSET_MS = 8 * HOUR_MS

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

function isWeekendBeijingAt(timestamp: number): boolean {
  // Shift into Beijing time, then read the weekday from the UTC calendar.
  const day = new Date(timestamp + BEIJING_OFFSET_MS).getUTCDay()
  return day === 0 || day === 6
}

function isPeakAt(timestamp: number): boolean {
  if (timestamp >= WEEKEND_RULE_UTC && isWeekendBeijingAt(timestamp)) return false
  const date = new Date(timestamp)
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60
  return PEAK_WINDOWS_UTC.some(
    ({ startHour, endHour }) => hour >= startHour && hour < endHour,
  )
}

function nextLiveBoundary(timestamp: number): { at: number; label: "PEAK" | "OFF-PEAK" } {
  const dayStart = startOfUtcDay(timestamp)
  // Look far enough ahead to cross a full weekend without peak windows.
  const candidates = []
  for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
    const base = dayStart + dayOffset * DAY_MS
    for (const { startHour, endHour } of PEAK_WINDOWS_UTC) {
      candidates.push(
        { at: base + startHour * HOUR_MS, label: "PEAK" as const },
        { at: base + endHour * HOUR_MS, label: "OFF-PEAK" as const },
      )
    }
  }

  const next = candidates
    .filter((candidate) => candidate.at > timestamp)
    // After the weekend rule takes effect, weekends never leave off-peak.
    .filter(
      (candidate) =>
        candidate.at < WEEKEND_RULE_UTC || !isWeekendBeijingAt(candidate.at),
    )
    .sort((a, b) => a.at - b.at)

  if (next.length > 0) return next[0]!
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
