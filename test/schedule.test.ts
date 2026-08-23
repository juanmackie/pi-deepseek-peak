import { describe, expect, it } from "vitest"
import {
  CUTOVER_UTC,
  formatCountdown,
  getScheduleSnapshot,
  isPeak,
  WEEKEND_RULE_UTC,
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

  describe("weekend rule", () => {
    it("exposes the weekend rule effective instant as Sunday 00:00 Beijing", () => {
      expect(new Date(WEEKEND_RULE_UTC).toISOString()).toBe("2026-08-22T16:00:00.000Z")
      expect(new Date(WEEKEND_RULE_UTC + 8 * 60 * 60 * 1000).getUTCDay()).toBe(0)
    })

    it("keeps weekday windows on Beijing-weekend days before the rule takes effect", () => {
      // Saturday in Beijing, but still before the weekend rule cutover.
      expect(isPeak(at("2026-08-22T02:30:00.000Z"))).toBe(true)
      expect(getScheduleSnapshot(at("2026-08-22T06:30:00.000Z")).nextLabel).toBe("OFF-PEAK")
      const snapshot = getScheduleSnapshot(at("2026-08-22T09:59:59.999Z"))
      expect(snapshot.phase).toBe("peak")
    })

    it("switches to the weekend rule exactly at its effective instant", () => {
      const before = getScheduleSnapshot(at("2026-08-22T15:59:59.999Z"))
      expect(before.phase).toBe("off")
      // The projection already knows Sunday's windows will never bill at peak.
      expect(before.nextLabel).toBe("PEAK")
      expect(before.nextBoundaryUtc.toISOString()).toBe("2026-08-24T01:00:00.000Z")

      const snapshot = getScheduleSnapshot(at("2026-08-22T16:00:00.000Z"))
      expect(snapshot.phase).toBe("off")
      // Sunday's windows are gone; the countdown runs to Monday's first window.
      expect(snapshot.nextLabel).toBe("PEAK")
      expect(snapshot.nextBoundaryUtc.toISOString()).toBe("2026-08-24T01:00:00.000Z")
    })

    it("charges off-peak all day across a full weekend", () => {
      const probes = [
        "2026-08-23T00:00:00.000Z",
        "2026-08-23T02:00:00.000Z",
        "2026-08-23T07:00:00.000Z",
        "2026-08-23T09:59:59.999Z",
        "2026-08-23T15:59:59.999Z",
      ]
      for (const probe of probes) {
        expect(isPeak(at(probe))).toBe(false)
        expect(getScheduleSnapshot(at(probe)).phase).toBe("off")
      }
      // Peak resumes with Monday's first window.
      expect(isPeak(at("2026-08-24T01:00:00.000Z"))).toBe(true)
    })

    it("targets Monday's first window throughout the weekend", () => {
      for (const probe of ["2026-08-22T20:00:00.000Z", "2026-08-23T12:00:00.000Z", "2026-08-23T15:00:00.000Z"]) {
        const snapshot = getScheduleSnapshot(at(probe))
        expect(snapshot.nextLabel).toBe("PEAK")
        expect(snapshot.nextBoundaryUtc.toISOString()).toBe("2026-08-24T01:00:00.000Z")
      }
    })

    it("resumes weekday windows immediately after the weekend ends", () => {
      // Monday 00:00 Beijing: off-peak again but back on the weekday ladder.
      const snapshot = getScheduleSnapshot(at("2026-08-23T16:00:00.000Z"))
      expect(snapshot.phase).toBe("off")
      expect(snapshot.nextLabel).toBe("PEAK")
      expect(snapshot.nextBoundaryUtc.toISOString()).toBe("2026-08-24T01:00:00.000Z")
    })

    it("rolls from the last weekday window into the next weekend", () => {
      // Thursday night: Friday's windows still apply, then the weekend is skipped.
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
