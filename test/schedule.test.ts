import { describe, expect, it } from "vitest"
import {
  CUTOVER_UTC,
  formatCountdown,
  getScheduleSnapshot,
  isPeak,
} from "../extensions/deepseek-peak/schedule.ts"

const at = (value: string) => new Date(value)

describe("DeepSeek pricing schedule", () => {
  it("keeps the would-be phase and counts down to cutover", () => {
    const snapshot = getScheduleSnapshot(at("2026-08-16T02:00:00.000Z"))
    expect(snapshot.phase).toBe("peak")
    expect(snapshot.preCutover).toBe(true)
    expect(snapshot.nextLabel).toBe("LIVE")
    expect(snapshot.nextBoundaryUtc.getTime()).toBe(CUTOVER_UTC)
  })

  it("switches to the live schedule exactly at cutover", () => {
    expect(getScheduleSnapshot(at("2026-08-16T15:59:59.999Z")).preCutover).toBe(true)
    const snapshot = getScheduleSnapshot(at("2026-08-16T16:00:00.000Z"))
    expect(snapshot.preCutover).toBe(false)
    expect(snapshot.phase).toBe("off")
    expect(snapshot.nextLabel).toBe("PEAK")
  })

  it.each([
    ["2026-08-17T00:59:59.999Z", false, "PEAK"],
    ["2026-08-17T01:00:00.000Z", true, "OFF-PEAK"],
    ["2026-08-17T03:59:59.999Z", true, "OFF-PEAK"],
    ["2026-08-17T04:00:00.000Z", false, "PEAK"],
    ["2026-08-17T05:59:59.999Z", false, "PEAK"],
    ["2026-08-17T06:00:00.000Z", true, "OFF-PEAK"],
    ["2026-08-17T09:59:59.999Z", true, "OFF-PEAK"],
    ["2026-08-17T10:00:00.000Z", false, "PEAK"],
  ])("handles half-open window boundary %s", (timestamp, expectedPeak, nextLabel) => {
    const now = at(timestamp)
    expect(isPeak(now)).toBe(expectedPeak)
    expect(getScheduleSnapshot(now).nextLabel).toBe(nextLabel)
  })

  it("rolls from the last window to the next day", () => {
    const snapshot = getScheduleSnapshot(at("2026-08-17T23:59:59.000Z"))
    expect(snapshot.phase).toBe("off")
    expect(snapshot.nextBoundaryUtc.toISOString()).toBe("2026-08-18T01:00:00.000Z")
  })

  it("formats day, hour, and minute countdowns", () => {
    expect(formatCountdown(0)).toBe("00h 00m")
    expect(formatCountdown(2 * 60 * 60 * 1000 + 13 * 60 * 1000)).toBe("02h 13m")
    expect(formatCountdown(1 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000 + 3 * 60 * 1000)).toBe("1d 02h 03m")
  })
})
