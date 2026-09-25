# `components/shell`

The frame around every screen, and what sits in it.

| File | Role |
| --- | --- |
| `AppShell.tsx` | Task 25 — the sidebar shell and the navigation registry, `NAV_ITEMS` |
| `AccountMenu.tsx` | The avatar menu in the top bar: *Settings* and *Remove this browser* |
| `StorageMeter.tsx` | The account's storage bar, in the sidebar corner — stored bytes solid, reservations behind them |
| `StagingBanner.tsx` | The walking red warning banner, dev-only — see [`app`](../../app/README.md#the-staging-banner) |

## Layout and design system

The shell is a Drive-style dashboard: a fixed left sidebar with the logo, the navigation and the
account summary, a sticky top bar carrying the current section's title and the session-exit
buttons, and a full-width content column. Below the `md` breakpoint the sidebar folds into a
sticky top header with a horizontally scrolling nav row.

Navigation is one registry, `NAV_ITEMS` in `AppShell.tsx`. Each entry is
`{ id, label, description, icon, screen, actions? }`; adding a section means adding one entry and
its screen component — the sidebar, the mobile nav and the top-bar heading all render from the
same array. Notes was added exactly that way, as one entry; Guardians was **removed** exactly that
way on 2026-09-04, by deleting one. `actions` is the optional slot for a component rendered in the
top bar beside Lock and the account menu, for controls that belong to the whole screen rather than to one
panel; the Vault's global reveal toggle is the first of them. State shared between such a control
and its screen lives in a provider wrapping the shell, as `VaultReveal.tsx` does, since the header
sits outside the screen's tree.

## Reading widths are capped; miniature grids are not

`main` is `mx-auto w-full`, and the cap depends on what the screen shows. Beyond about 1150px a
line of prose or a table row stops being generous and starts being hard to read — actions a metre
from the name they belong to, a two-column grid with a chasm down the middle. **A grid of tiles has
the opposite problem**: capping it wastes rows and forces scrolling past space that was right
there.

So `NavItem.miniatures` decides. Notes, Documents, Shared and Drive set it and render at
`max-w-none`; Vault stays `max-w-6xl`. The desktop header's inner row uses the same value, so the
page title always sits on the left edge of whatever is under it. The cap is on the content, never
on the shell — the sidebar and sticky header span the window either way.

**`NoteEditor` carries its own `max-w-5xl`,** because it lives inside the full-width Notes screen
but is prose, not tiles. Without it, opening a note on a wide monitor gives you a line length
nobody wants to write in. The documents editor needs no equivalent: `/docs/[id]` is its own route
with its own A4 measure.

Type is Inter with JetBrains Mono for data, both from `next/font`, exposed as `font-sans` /
`font-mono`. The scale is named rather than numeric: `text-caption` (11px, uppercase, tracked —
badges and metadata), `text-compact` (13px — the workhorse for body copy, table cells and button
labels), `text-title` (15px/600 — card headings), `text-headline` (18px/600), `text-headline-lg`
(22px/600 — the top-bar section title), `text-display` (28px/700).

**The action gradient (`#6366f1` → `#8b5cf6`, the `.brand-gradient` class) is rationed to one
element per screen** — the notes FAB, the New-document button, the account avatar. That is the
design system's own rule: gradients work on a hero, and fight the content when they spread across
a dense UI. Everything else is a flat token.

## The account menu

The sidebar holds the **places you keep things** — vault, notes, documents, drive. Everything about
the account itself lives behind the avatar in the top right: clicking it opens a menu with
**Settings** and **Remove this browser**.

**Lock is not in that menu**, and that is deliberate. It sits as its own button immediately to the
left of the avatar, because it is the one control a person reaches for in a hurry — someone walking
up behind them. A control you need in two seconds does not belong two clicks deep. It is always
there, because the device record survives a lock.

Settings itself is [`components/settings`](../settings/README.md).
