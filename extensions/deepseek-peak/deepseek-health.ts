export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const BALANCE_PATH = "user/balance"
export const DEFAULT_TIMEOUT_MS = 8_000

export interface ResolvedProviderAuth {
  readonly auth?: {
    readonly apiKey?: string
    readonly headers?: Readonly<Record<string, string | null>>
    readonly baseUrl?: string
  }
}

export type HealthStatus =
  | "ok"
  | "insufficient-balance"
  | "offline"
  | "no-key"
  | "invalid-base-url"
  | "conflicting-authorization"
  | "auth-error"
  | "http-error"
  | "network-error"
  | "timeout"
  | "invalid-response"

export interface HealthResult {
  readonly status: HealthStatus
  readonly degraded: boolean
  /** HTTP status only; response bodies are intentionally never retained. */
  readonly httpStatus?: number
}

export interface HealthCheckOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly offline?: boolean
}

function isOfflineEnvironment(): boolean {
  const value = process.env.PI_OFFLINE?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

function invalidResult(status: "invalid-base-url" | "conflicting-authorization"): HealthResult {
  return { status, degraded: true }
}

function resolveBalanceUrl(baseUrl: string | undefined): URL | HealthResult {
  const raw = baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL
  let base: URL
  try {
    base = new URL(raw)
  } catch {
    return invalidResult("invalid-base-url")
  }

  // Never send a resolved provider credential over plaintext or to a URL with
  // embedded credentials. Redirects are disabled on the request as well.
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    return invalidResult("invalid-base-url")
  }

  const normalizedPath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
  base.pathname = normalizedPath
  return new URL(BALANCE_PATH, base)
}

function hasAuthorizationHeader(headers: Readonly<Record<string, string | null>> | undefined): boolean {
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization")
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
}

/**
 * Check the authenticated DeepSeek account endpoint without exposing secrets.
 * A successful response means auth/account reachability, not model inference
 * health. The balance values are deliberately parsed only for shape and are
 * never returned to the caller.
 */
export async function checkDeepSeekHealth(
  resolved: ResolvedProviderAuth | undefined,
  options: HealthCheckOptions = {},
): Promise<HealthResult> {
  if (options.offline ?? isOfflineEnvironment()) {
    return { status: "offline", degraded: false }
  }

  const auth = resolved?.auth
  const apiKey = auth?.apiKey?.trim()
  if (!apiKey) return { status: "no-key", degraded: true }

  if (hasAuthorizationHeader(auth?.headers)) {
    return invalidResult("conflicting-authorization")
  }

  const url = resolveBalanceUrl(auth?.baseUrl)
  if (url instanceof URL === false) return url

  const headers: Record<string, string> = { Accept: "application/json" }
  for (const [key, value] of Object.entries(auth?.headers ?? {})) {
    if (value !== null && key.toLowerCase() !== "authorization") headers[key] = value
  }
  headers.Authorization = `Bearer ${apiKey}`

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener("abort", onAbort, { once: true })

  if (controller.signal.aborted) {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onAbort)
    return { status: "timeout", degraded: true }
  }

  try {
    const fetchImpl = options.fetch ?? globalThis.fetch
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: controller.signal,
    })

    if (!response.ok) {
      return {
        status: response.status === 401 ? "auth-error" : "http-error",
        degraded: true,
        httpStatus: response.status,
      }
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { status: "invalid-response", degraded: true }
    }

    if (body === null || typeof body !== "object") {
      return { status: "invalid-response", degraded: true }
    }
    const record = body as Record<string, unknown>
    if (typeof record.is_available !== "boolean" || !Array.isArray(record.balance_infos)) {
      return { status: "invalid-response", degraded: true }
    }

    return record.is_available
      ? { status: "ok", degraded: false }
      : { status: "insufficient-balance", degraded: true }
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      return { status: "timeout", degraded: true }
    }
    return { status: "network-error", degraded: true }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onAbort)
  }
}
