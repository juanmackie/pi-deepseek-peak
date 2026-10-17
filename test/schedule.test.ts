import { describe, expect, it } from "vitest"
import {
  formatCountdown,
  getScheduleSnapshot,
  isPeak,
} from "../extensions/deepseek-peak/schedule.ts"

const at = (value: string) => new Date(value)

describe("DeepSeek pricing schedule", () => {
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

  describe("weekend rule (always active)", () => {
    it("treats Beijing weekends as off-peak with no peak windows", () => {
      // Saturday 02:30 Beijing (UTC 08-22 18:30 previous day?) — use a clear Beijing-weekend probe.
      // 2026-08-22 is Saturday in Beijing (UTC 08-22 08:00 = Beijing 16:00 Friday; let's use an explicit Sunday).
      // 2026-08-23 is Sunday in Beijing all day.
      expect(isPeak(at("2026-08-23T00:00:00.000Z"))).toBe(false)
      expect(isPeak(at("2026-08-23T07:00:00.000Z"))).toBe(false)
      expect(isPeak(at("2026-08-23T15:59:59.999Z"))).toBe(false)
    })

    it("counts from weekend through to Monday's first peak window", () => {
      for (const probe of ["2026-08-22T20:00:00.000Z", "2026-08-23T12:00:00.000Z", "2026-08-23T15:00:00.000Z"]) {
        const snapshot = getScheduleSnapshot(at(probe))
        expect(snapshot.phase).toBe("off")
        expect(snapshot.nextLabel).toBe("PEAK")
        expect(snapshot.nextBoundaryUtc.toISOString()).toBe("2026-08-24T01:00:00.000Z")
      }
    })

    it("resumes weekday windows immediately after the weekend ends", () => {
      // Monday 00:00 Beijing: off-peak until first peak window.
      const snapshot = getScheduleSnapshot(at("2026-08-24T01:00:00.000Z"))
      expect(snapshot.phase).toBe("peak")
      expect(snapshot.nextLabel).toBe("OFF-PEAK")
    })

    it("rolls from the last weekday window into the next weekend", () => {
      const thursdayNight = getScheduleSnapshot(at("2026-08-27T23:59:59.000Z"))
      expect(thursdayNight.nextBoundaryUtc.toISOString()).toBe("2026-08-28T01:00:00.000Z")

      const fridayLastWindow = getScheduleSnapshot(at("2026-08-28T09:59:59.000Z"))
      expect(fridayLastWindow.phase).toBe("peak")
      expect(fridayLastWindow.nextLabel).toBe("OFF-PEAK")

      // Saturday in Beijing: no more peaks until Monday.
      const saturday = getScheduleSnapshot(at("2026-08-29T07:00:00.000Z"))
      expect(saturday.phase).toBe("off")
      expect(saturday.nextBoundaryUtc.toISOString()).toBe("2026-08-31T01:00:00.000Z")
    })
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
