# Operations guide

This guide covers the durable operator actions for `pi-deepseek-peak`.

## Install, update, and remove

After publication, install the latest package globally for pi:

```sh
pi install npm:pi-deepseek-peak
```

For a pinned published version:

```sh
pi install npm:pi-deepseek-peak@0.1.0
```

After installation, restart pi or run `/reload` in an existing session.

Update an installed package:

```sh
pi update npm:pi-deepseek-peak
```

Remove it:

```sh
pi remove npm:pi-deepseek-peak
```

For local development:

```sh
npm install
npm run typecheck
npm test
npm run pack:check
pi install ./
```

A direct one-session load does not change pi's package settings:

```sh
pi -e ./extensions/deepseek-peak/index.ts
```

## Credential and network boundary

The extension asks pi for the resolved `deepseek` provider auth record through
`ctx.modelRegistry.getProviderAuth("deepseek")`. Configure that record with
pi's `/login` flow or the provider's existing `DEEPSEEK_API_KEY` environment
variable.

The extension then makes a read-only request to the resolved provider base URL:

```text
GET /user/balance
Authorization: Bearer <resolved key>
Accept: application/json
```

Operational safeguards:

- no key is written to this package's files, session entries, logs, or status;
- no balance amount is rendered, persisted, or sent to the model;
- custom destinations must use HTTPS and cannot contain URL credentials;
- conflicting provider-supplied `Authorization` headers are rejected;
- redirects are disabled, preventing a credential from following a redirect to
  another origin;
- requests are timeout-bounded and cancelled during session shutdown;
- `PI_OFFLINE=1`, `true`, or `yes` skips this extension-owned request.

A successful response proves that the account/auth endpoint is reachable. It
does not prove model inference health, latency, or capacity.

## Reading the status

| Status | Meaning |
| --- | --- |
| `DS ● OFF-PEAK · ... → PEAK` | The live schedule is off-peak and the next transition is peak. |
| `DS ● PEAK · ... → OFF-PEAK` | The live schedule is peak and the next transition is off-peak. |
| `PRE-CUTOVER ... → LIVE` | The displayed phase is a schedule projection; DeepSeek's flat pricing still applies until the cutover. |
| `⚠` | The schedule is still available, but account/API health is degraded. |
| no `⚠` | The balance endpoint returned a valid, available account response, or health checks are intentionally offline. |

The schedule is calculated from the host clock in UTC. It is not an API claim
because DeepSeek does not document a current-phase endpoint.

## Troubleshooting

### The status is missing

1. Confirm the package is installed:

   ```sh
   pi list
   ```

2. Run `/reload`, or restart pi.
3. For a direct test, run:

   ```sh
   pi -e ./extensions/deepseek-peak/index.ts
   ```

The extension uses a named status item in pi's default footer; it does not
replace the footer with a custom renderer.

### The status shows `⚠`

Check the credential and endpoint configuration:

```text
/login
```

Common causes are a missing key, an invalid key, an HTTP error, a timeout, a
network outage, malformed upstream JSON, an unsafe custom provider URL, or an
account whose `is_available` value is false. The warning is intentionally
compact and does not display server response bodies or account amounts.

### I am offline

Set `PI_OFFLINE=1` before starting pi in a POSIX shell. On PowerShell, use
`$env:PI_OFFLINE = "1"`. The schedule and countdown continue to work locally,
and intentional offline mode does not add a warning.

### The phase looks wrong

The package uses UTC and the local system clock. Check the host clock first.
Then compare the baked-in schedule with
[DeepSeek's pricing page](https://api-docs.deepseek.com/quick_start/pricing/).
If DeepSeek changes the windows or effective date, update the package before
relying on its output; there is no documented API endpoint that can refresh
this schedule automatically.

## Maintainer verification

Run the full local checks before publishing or handing off a change:

In a POSIX shell:

```sh
npm install
npm run typecheck
npm test
npm run pack:check
PI_OFFLINE=1 pi --no-session --no-tools \
  -e ./extensions/deepseek-peak/index.ts \
  -p "reply with exactly OK"
```

On PowerShell, run the same npm commands and set the smoke-test environment
variable before invoking pi:

```powershell
$env:PI_OFFLINE = "1"
pi --no-session --no-tools -e .\extensions\deepseek-peak\index.ts -p "reply with exactly OK"
```

The automated tests cover schedule boundaries and mocked API/lifecycle failure
states. A real API check is not part of CI because it would require a secret
and should not be coupled to a user's account or balance.
