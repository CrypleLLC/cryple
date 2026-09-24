# `lib/security-headers`

The HTTP response headers every route sends. `next.config.ts` calls `securityHeaders` once and
attaches the result to `/:path*`. Framework-free, so the policy is unit-tested rather than
eyeballed in a browser.

| Export | What it is |
| --- | --- |
| `securityHeaders(options)` | The full header list for `next.config.ts` |
| `contentSecurityPolicy(options)` | The policy, sent as the enforced `Content-Security-Policy` |
| `connectSources(options)` | `'self'`, the API origin and the object-store origins, de-duplicated |
| `requireObjectStoreOrigins(urls)` | The object-store origins, or `ObjectStoreOriginsError` if there are none or one does not parse |
| `originOf(url)` | The `http(s)` origin of a URL, or `undefined` |
| `objectStoreUrlsFrom(value)` | Parses `CSP_OBJECT_STORE_ORIGINS` |

## Why a zero-knowledge client needs this more than most

Everything the server stores is ciphertext, so the only place plaintext exists is this tab. Any
script that runs here — an injected one, a compromised dependency, a third-party toolbar — can read
it, and without a policy it can send it to any host and nothing notices. `connect-src` and
`img-src` are what turn that into a blocked request. They matter more here than `script-src`, which
App Router forces to allow inline scripts anyway.

## The policy, enforced

It shipped report-only on 2026-09-13 and was switched to enforced the same day ([Task 40.6](../../../tasks/tasks.md)).
There is one `Content-Security-Policy` header and no report-only copy.

| Directive | Sources | Why |
| --- | --- | --- |
| `default-src` | `'self'` | |
| `script-src` | `'self' 'unsafe-inline'`, plus `'unsafe-eval'` in development | App Router inlines its flight data with no nonce. What this still blocks is a script from any other host — including the Vercel Toolbar that preview deployments inject from `vercel.live` |
| `style-src` | `'self' 'unsafe-inline'` | React `style` props and TipTap's inline marks are style attributes |
| `img-src` | `'self' blob: data:` | Drive thumbnails are `blob:` URLs of bytes decrypted in this tab. No remote image is ever legitimate, which is also what stops a pasted-formatting beacon ([`lib/document-styles`](../document-styles/README.md)) |
| `font-src` | `'self' data:` | `next/font` self-hosts at build time. No request reaches Google Fonts at runtime |
| `connect-src` | `'self'`, the API, the object stores | The API from `NEXT_PUBLIC_BASE_API_URL`; the stores from `CSP_OBJECT_STORE_ORIGINS`. `'self'` also covers the dev server's HMR WebSocket |
| `media-src`, `worker-src` | `'self' blob:` | |
| `frame-src` | `'none'` | Nothing is embedded |
| `frame-ancestors` | `'none'` | No other site can frame the vault or the recovery phrase and trick a click. `X-Frame-Options: DENY` says the same to older browsers |
| `object-src`, `base-uri` | `'none'` | |
| `form-action` | `'none'` | The one `<form>` (the unlock screen) always prevents its default submit, so a submit that reaches the network is a bug |

Downloads are not governed by any of this. The drive, a shared file and the recovery kit all save
through an `<a download>` on a `blob:` URL, which is a navigation to a download, not a fetch.

## `CSP_OBJECT_STORE_ORIGINS`, and why a production build fails without it

A comma-separated list, read when `next.config.ts` builds the headers, of every origin a presigned
URL can point at. **That is the API's `R2_ENDPOINT`**, the host the browser sends to:
`https://<account-id>.r2.cloudflarestorage.com` against real R2, `http://localhost:9000` against the
local MinIO compose. Paths are dropped, so a full URL works too.

**The client only ever talks to that one store.** The GCS replica is written and read by the
`reconcile` worker alone; the API hands the browser presigned URLs for R2 and nothing else.

- **A production build (`NODE_ENV=production`) throws `ObjectStoreOriginsError`** when the variable
  is empty or an entry does not parse as an `http(s)` URL. Vercel builds preview deployments in
  production mode too, so **the variable has to be set for every Vercel environment**. A failed
  deployment is loud; a deployed policy without the store fails silently in the tab, as
  `Failed to fetch` on the first upload, after the row and the quota are already spent.
- **The development server does not throw.** It builds the same policy from whatever is there, so a
  missing value shows up as a CSP violation in the console naming the blocked host. Put the local
  API's `R2_ENDPOINT` in `.env.local`.

## Two decisions, and when to revisit them

Both were weighed on 2026-09-13 rather than left at their defaults.

- **No reporting endpoint.** A violation only reaches the console of the tab it happened in. An
  API route receiving `report-to` payloads would get blocked URLs and never content, but it is a new
  public, unauthenticated route that accepts arbitrary JSON, for a policy with no third-party origin
  that could legitimately change under it. **Revisit** when the policy has to admit a host this repo
  does not control, because that is when a violation stops being a bug a developer will see first.
- **No script nonces.** A nonce has to be generated per response in middleware, which makes every
  route dynamic and drops the static prerendering the app relies on. What a nonce would add is
  blocking an **injected inline** script. The layers that already stand in that way: every piece
  of text the app renders goes through React or `escapeHtml`, and `form-action`, `base-uri` and
  `connect-src` stop the usual exfiltration paths even if a script does run. **Revisit** if anything
  starts rendering HTML it did not build itself.

## The rest of the headers

| Header | Value | Why |
| --- | --- | --- |
| `Referrer-Policy` | `no-referrer` | A `/docs/<id>` path is nobody else's business |
| `X-Content-Type-Options` | `nosniff` | |
| `Cross-Origin-Opener-Policy` | `same-origin` | A cross-origin page that opens this one gets no handle to it; the same-origin opener the session handoff relies on is kept |
| `Permissions-Policy` | camera, microphone, geolocation, payment and USB off | Nothing uses them. Clipboard is deliberately not restricted, because the vault copies |

**HSTS is not set here.** Vercel sends it on its own domains, and `includeSubDomains` on the product
domain would bind every sibling subdomain — a decision for the domain, not for this app.

## Changing the policy

- **Never add `*`, `https:` or `http:` as a source.** A test fails if any directive does, because
  each of them hands exfiltration back to any host.
- **A new third-party origin needs an argument**, the same way a new `localStorage` exemption does
  in `eslint.config.mjs`: who runs it, and what it can read from a tab full of plaintext.
- **Check a change in a production build**, not only `next dev`: development adds `'unsafe-eval'`,
  so a policy that works there can still break the deployed app.
