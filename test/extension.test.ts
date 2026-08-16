import { afterEach, describe, expect, it, vi } from "vitest"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import extension from "../extensions/deepseek-peak/index.ts"

function makeHarness() {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>()
  const setStatus = vi.fn()
  let themePrefix = "A"
  const theme = {
    fg: (color: string, text: string) => `${themePrefix}[${color}]${text}`,
  }
  const ctx = {
    ui: { theme, setStatus },
    modelRegistry: { getProviderAuth: vi.fn().mockResolvedValue(undefined) },
  } as unknown as ExtensionContext
  const pi = {
    on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, handler)
    }),
  } as unknown as ExtensionAPI

  extension(pi)
  return {
    ctx,
    handlers,
    setStatus,
    get themePrefix() { return themePrefix },
    set themePrefix(value: string) { themePrefix = value },
  }
}

async function settle(): Promise<void> {
  await vi.runAllTicks()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("DeepSeek peak pi extension", () => {
  it("renders the schedule immediately and appends a compact warning after health resolves", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-16T02:00:00.000Z"))
    const harness = makeHarness()
    await harness.handlers.get("session_start")!(undefined, harness.ctx)
    const initial = harness.setStatus.mock.calls.at(-1)?.[1] as string
    expect(initial).toContain("PRE-CUTOVER")
    expect(initial).toContain("LIVE")

    await settle()
    const last = harness.setStatus.mock.calls.at(-1)?.[1] as string
    expect(last).toContain("⚠")
    expect(last).toContain("DS")
  })

  it("keeps one schedule timer when a session starts repeatedly", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"))
    const harness = makeHarness()
    const start = harness.handlers.get("session_start")!
    await start(undefined, harness.ctx)
    await start(undefined, harness.ctx)
    await settle()

    // One minute-boundary timer and one five-minute health timer remain.
    expect(vi.getTimerCount()).toBe(2)
    expect(harness.setStatus.mock.calls.filter(([key]) => key === "deepseek-peak").length).toBeGreaterThan(1)
  })

  it("renders a warning when pi credential resolution fails", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"))
    const harness = makeHarness()
    harness.ctx.modelRegistry.getProviderAuth = vi.fn().mockRejectedValue(new Error("secret auth detail"))
    await harness.handlers.get("session_start")!(undefined, harness.ctx)
    await settle()

    const last = harness.setStatus.mock.calls.at(-1)?.[1] as string
    expect(last).toContain("⚠")
    expect(last).not.toContain("secret auth detail")
  })

  it("re-reads the current theme whenever the schedule updates", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"))
    const harness = makeHarness()
    await harness.handlers.get("session_start")!(undefined, harness.ctx)
    await settle()
    harness.themePrefix = "B"
    await vi.advanceTimersByTimeAsync(60_100)

    const last = harness.setStatus.mock.calls.at(-1)?.[1] as string
    expect(last).toContain("B[muted]")
  })

  it("does not let a late health response repaint after shutdown", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"))
    let resolveFetch!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal("fetch", fetch)

    const harness = makeHarness()
    harness.ctx.modelRegistry.getProviderAuth = vi.fn().mockResolvedValue({
      auth: { apiKey: "do-not-render", baseUrl: "https://api.deepseek.com" },
    })
    await harness.handlers.get("session_start")!(undefined, harness.ctx)
    await settle()
    expect(fetch).toHaveBeenCalledOnce()

    await harness.handlers.get("session_shutdown")!(undefined, harness.ctx)
    resolveFetch(new Response(JSON.stringify({ is_available: true, balance_infos: [] })))
    await settle()

    expect(harness.setStatus.mock.calls.at(-1)).toEqual(["deepseek-peak", undefined])
    expect(harness.setStatus.mock.calls.flat().join(" ")).not.toContain("do-not-render")
  })
})
