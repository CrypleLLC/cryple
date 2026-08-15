# `app`

The Next.js App Router entry point. Routing and page-level assets only — the React surface lives
in [`src/components`](../components/README.md) and every testable decision in
[`src/lib/app`](../lib/app/README.md).

| File                 | Role                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `layout.tsx`         | The root layout, fonts, `metadata`, the shared `AppProviders`, and `StagingBanner`                                   |
| `page.tsx`           | The dashboard, behind `SessionGate`                                                                                  |
| `docs/[id]/page.tsx` | One document, behind `SessionGate` — the editor route                                                                |
| `globals.css`        | Tailwind import, the `brand` colour scale, light/dark surface tokens, `.cryple-prose`, the `.staging-banner` marquee |

## The staging banner

`StagingBanner` (in [`src/components`](../components/README.md)) renders only when
`process.env.NEXT_PUBLIC_ENV === 'development'`

## Why the provider moved into the layout

Documents open in their own browser tab, so `/` and `/docs/[id]` are separate entry points that
both need a session. `CrypleProvider` therefore mounts once in `layout.tsx` (via the
`AppProviders` client boundary) and each route wraps its own content in `SessionGate`, which
renders the loading / onboarding / locked screens and passes through only when the session is
ready.

A newly opened tab is always locked — key material lives in memory, per JS context. It recovers
without a prompt by asking already-unlocked tabs over a same-origin `BroadcastChannel`; see
[`lib/session`](../lib/session/README.md).

The editor route is code-split: TipTap and Yjs load on `/docs/[id]` and, lazily, on the dashboard's
Documents tab. The dashboard's own first load does not pay for them.
| `icon.svg` · `icon.png` · `apple-icon.png` | The browser-tab and home-screen icon set |

## The icon set

These are **file-convention icons**, not `metadata.icons`. Next generates the `<link>` tags from
the filenames, which is why `layout.tsx` declares no icons of its own — a metadata entry loses to
a file, and that is exactly what happened while the scaffold's `favicon.ico` was still present:
it kept serving the Create Next App logo no matter what the metadata said. That file is deleted;
do not add another `favicon.ico`.

Three files, because they answer three different requests:

| File             | Size    | Why it exists                                                   |
| ---------------- | ------- | --------------------------------------------------------------- |
| `icon.svg`       | vector  | What modern browsers actually use — crisp at every zoom and DPI |
| `icon.png`       | 32×32   | Fallback for clients that will not take an SVG favicon          |
| `apple-icon.png` | 180×180 | iOS home screen, which ignores the other two                    |

`icon.png` is **tuned to the 32-pixel grid rather than downscaled** from the 500×500 logo: the
bars are 6px tall on integer rows (18–23 and 26–31), the arch is `r=15` outer and `r=8` inner
about a centre at (16, 16), and the corner radius is 2. Every horizontal and vertical edge
therefore lands on a pixel boundary and renders without the grey fringe a resample produces. If
you regenerate it, check that the straight bar rows come out fully opaque edge to edge — only the
rounded corners may be partially transparent.

`apple-icon.png` is drawn on **opaque white with the logo inset to 70%**. iOS composites a home
screen icon on black where it is transparent and masks it to a rounded rectangle, so the vault
logo's full-bleed bars would otherwise be clipped at both ends. The inset is that safe area.

### The logo geometry

Measured off `public/cryple-logo.png` and reproduced as vectors, on a 500×500 grid in `#667eea`:

- **arch** — a half annulus, outer `r=227`, inner `r=112`, flat edge at `y=227`
- **bars** — 500×99 rounded rectangles, `rx=27`, at `y=262.5` and `y=397.5`
- **rhythm** — a 36-unit gap below the arch and between the bars

`icon.svg` is that geometry centred on the canvas; the source logo's arch sits ~4px right of
centre, which is invisible at icon sizes and not worth reproducing. `public/cryple-logo.png` is
still the raster the app itself renders in the sidebar and on the sign-in screens.
