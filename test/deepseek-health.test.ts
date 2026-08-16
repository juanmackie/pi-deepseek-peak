import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkDeepSeekHealth,
  type ResolvedProviderAuth,
} from "../extensions/deepseek-peak/deepseek-health.ts"

const auth = (overrides: NonNullable<ResolvedProviderAuth["auth"]> = {}): ResolvedProviderAuth => ({
  auth: { apiKey: "secret-key", ...overrides },
})

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const funded = { is_available: true, balance_infos: [{ currency: "USD", total_balance: "99.99" }] }
const unfunded = { is_available: false, balance_infos: [{ currency: "USD", total_balance: "0" }] }

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.PI_OFFLINE
})

describe("checkDeepSeekHealth", () => {
  it("skips intentionally in offline mode", async () => {
    const fetch = vi.fn()
    await expect(checkDeepSeekHealth(auth(), { offline: true, fetch })).resolves.toEqual({
      status: "offline",
      degraded: false,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("reports missing credentials without making a request", async () => {
    const fetch = vi.fn()
    await expect(checkDeepSeekHealth({ auth: {} }, { fetch })).resolves.toMatchObject({ status: "no-key", degraded: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("uses the resolved base URL and sends one bearer credential", async () => {
    const fetch = vi.fn().mockResolvedValue(response(funded))
    const result = await checkDeepSeekHealth(auth({
      baseUrl: "https://proxy.example.test/v1/",
      headers: { "X-Trace": "trace-id" },
    }), { fetch })

    expect(result).toEqual({ status: "ok", degraded: false })
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://proxy.example.test/v1/user/balance"),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "X-Trace": "trace-id",
          Authorization: "Bearer secret-key",
        },
      }),
    )
  })

  it("preserves authenticated but insufficient balance as a warning state", async () => {
    const fetch = vi.fn().mockResolvedValue(response(unfunded))
    await expect(checkDeepSeekHealth(auth(), { fetch })).resolves.toEqual({
      status: "insufficient-balance",
      degraded: true,
    })
  })

  it.each(["http://api.deepseek.com", "not a url", "https://user:pass@api.deepseek.com"]) (
    "rejects unsafe base URL %s",
    async (baseUrl) => {
      const fetch = vi.fn()
      await expect(checkDeepSeekHealth(auth({ baseUrl }), { fetch })).resolves.toMatchObject({
        status: "invalid-base-url",
        degraded: true,
      })
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it("rejects a provider-supplied authorization header", async () => {
    const fetch = vi.fn()
    await expect(checkDeepSeekHealth(auth({ headers: { authorization: "Bearer wrong" } }), { fetch })).resolves.toMatchObject({
      status: "conflicting-authorization",
      degraded: true,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps auth and other HTTP failures without retaining response bodies", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ secret: "do-not-return" }, 401))
    await expect(checkDeepSeekHealth(auth(), { fetch })).resolves.toEqual({
      status: "auth-error",
      degraded: true,
      httpStatus: 401,
    })

    fetch.mockResolvedValue(response({ message: "server detail" }, 503))
    await expect(checkDeepSeekHealth(auth(), { fetch })).resolves.toEqual({
      status: "http-error",
      degraded: true,
      httpStatus: 503,
    })
  })

  it("rejects malformed success responses", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ is_available: true }))
    await expect(checkDeepSeekHealth(auth(), { fetch })).resolves.toMatchObject({ status: "invalid-response", degraded: true })
  })

  it("honors an already-aborted caller signal", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn()
    await expect(checkDeepSeekHealth(auth(), { fetch, signal: controller.signal })).resolves.toMatchObject({
      status: "timeout",
      degraded: true,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("maps network failures and abort timeouts", async () => {
    const network = vi.fn().mockRejectedValue(new Error("secret network detail"))
    await expect(checkDeepSeekHealth(auth(), { fetch: network })).resolves.toMatchObject({ status: "network-error", degraded: true })

    const timeout = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
    }))
    await expect(checkDeepSeekHealth(auth(), { fetch: timeout, timeoutMs: 1 })).resolves.toMatchObject({ status: "timeout", degraded: true })
  })
})
