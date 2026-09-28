# `components/shell`

The frame around every screen, and what sits in it.

| File | Role |
| --- | --- |
| `AppShell.tsx` | Task 25 — the sidebar shell and the navigation registry, `NAV_ITEMS` |
| `AccountMenu.tsx` | The avatar menu in the top bar: *Settings* and *Remove this browser* |
| `ScreenStrip.tsx` | The full-width bar slot under the top bar, for a screen's own tabs |
| `ShellNavigation.tsx` | The context a screen uses to open another section — how Home's icons navigate |
| `SidePanel.tsx` | The right-hand panel a screen opens for its own context — `SidePanel` and `PanelFacts` |
| `StorageMeter.tsx` | The account's storage bar, in the sidebar corner — stored bytes solid, reservations behind them |
| `StagingBanner.tsx` | The walking red warning banner, dev-only — see [`app`](../../app/README.md#the-staging-banner) |

## Layout and design system

The shell is a Drive-style dashboard: a fixed left sidebar with the logo, the navigation and the
account summary, a sticky top bar carrying the current section's title and the session-exit
buttons, and a full-width content column. Below the `md` breakpoint the sidebar is hidden behind a
menu button at the left of a compact top bar, which shows the current section's name and the same
actions as the desktop one. The button opens `MobileMenu`, a drawer that slides in from the left
over a dimmed page and holds exactly what the sidebar holds (`SidebarContent`: logo, navigation,
storage meter). Choosing a section, the backdrop, the close button or Escape closes it, and the
page behind does not scroll while it is open. A screen's own tabs — the Vault and Notes strip — stay
on the page under the top bar, not in the drawer: they belong to the screen, not to navigation.

Navigation is one registry, `NAV_ITEMS` in `AppShell.tsx`. Each entry is
`{ id, label, description, icon, appIcon?, screen, actions? }`; adding a section means adding one entry and
its screen component — the sidebar, the mobile nav and the top-bar heading all render from the
same array. Notes was added exactly that way, as one entry; Guardians was **removed** exactly that
way on 2026-09-04, by deleting one. `actions` is the optional slot for a component rendered in the
top bar beside Lock and the account menu, for controls that belong to the whole screen rather than to one
panel; the Vault's global reveal toggle is the first of them. State shared between such a control
and its screen lives in a provider wrapping the shell, as `VaultReveal.tsx` does, since the header
sits outside the screen's tree.

**Home is the first entry, so it is the screen the app opens on.** It is the one screen that
changes section itself, and a screen is rendered as `<Screen />` with no props, so the shell hands
it the way through a context: `ShellNavigationProvider` wraps the screen with the scope-filtered
sections that carry an `appIcon` and the same `select` the sidebar calls. `appIcon` is the large
feature mark Home draws ([`components/home`](../home/README.md)); `icon` stays the small outline
glyph the sidebar draws. Home has no `appIcon`, so it does not list itself.

## The screen strip

Both headers and an empty slot under them share one sticky wrapper. A screen puts a full-width bar
there — the Vault and Notes tabs — by wrapping it in `ScreenStrip` (`ScreenStrip.tsx`), which portals
into the slot the shell provides through `ScreenStripSlotProvider`. The slot is `empty:hidden`, so a
screen that puts nothing there leaves no gap, and the bar is not capped by the content measure: it
starts at the sidebar's edge. Outside the shell, `ScreenStrip` renders its children in place.

**Both headers are `relative z-10`** above the slot. Their `backdrop-blur` makes each its own
stacking context, so the account menu's `z-20` only counts inside its header; without the header
itself sitting above the strip, the strip — later in the DOM, and blurred too — would paint over the
open menu.

## The side panel

The right-hand counterpart of the sidebar, and one component for every screen: `SidePanel` takes a
`title`, an optional `subtitle`, `onClose`, and whatever the screen wants to show. What it shows
depends on where it was opened — *Recently deleted* on Passwords, a file's or a folder's details on
the Drive. A screen opens it by rendering it and closes it by not rendering it, so it never outlives
the screen: switching section closes it.

It portals into a slot the shell keeps at the right end of its flex row (`SidePanelSlotProvider`,
the same pattern as the screen strip). **From `md` up it is a column**, 320px, full height and
sticky like the sidebar, and the content column narrows to make room. **Below `md` it is a drawer**
that slides in from the right over a dimmed page, takes the focus, and stops the page behind it
from scrolling. On both, the close button, Escape, and **a press anywhere outside the panel**
close it.

The control that opens a panel is the exception to that last rule, or pressing it again would
close the panel on the press and reopen it on the click. It carries `data-side-panel-trigger` —
spread `SIDE_PANEL_TRIGGER` on a `Button`, or pass `triggersSidePanel` to a `TileAction` — and the
screen makes it a toggle instead: *Recently deleted* opens and closes its panel, and a tile's
*Details* closes the panel when it is already showing that tile, or switches to it when it is
showing another.

**A modal opened from the panel is the other exception.** The Vault's *Recently deleted* asks for
confirmation before a permanent delete, in a [`Modal`](../modal/README.md) portalled outside the
panel. A press inside any `aria-modal="true"` dialog that is not the panel itself, and an Escape
while focus is in one, belong to that dialog: without this, confirming would close the panel
under it, and Escape would close both at once.

`PanelFacts` is the label-over-value list the details use, so every panel's facts look the same.

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
