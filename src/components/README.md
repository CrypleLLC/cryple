# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

## How this folder is organised

**One folder per domain, and a few shared kits the domains build on.** Each folder has its own
`README.md` with what its files do and why they are built the way they are.

Shared — no domain knowledge, imported through their `index.ts`:

| Folder | What it holds |
| --- | --- |
| [`ui`](./ui/README.md) | The primitives: `Card`, `Button`, the fields, `Badge`, `Notice`, `Empty`, `Spinner`, `CopyButton`, `SizeStepper`, and the icons |
| [`modal`](./modal/README.md) | `Modal`, and the shapes dialogs take: `FormModal`, `ConfirmDeleteModal`, `ModalActions` |
| [`item-list`](./item-list/README.md) | The item table the Vault and Passwords list their rows in |
| [`tiles`](./tiles/README.md) | The file-grid parts: `PageTile`, `TileCheckbox`, `TileAction` |

Domains — one folder each:

| Folder | What it is |
| --- | --- |
| [`session`](./session/README.md) | The session provider, the gate, onboarding and unlock |
| [`shell`](./shell/README.md) | The sidebar shell, navigation, account menu, storage meter, staging banner |
| [`vault`](./vault/README.md) | The Vault, and the show/hide-values toggle |
| [`passwords`](./passwords/README.md) | The Passwords tab |
| [`notes`](./notes/README.md) | The notes grid and the note editor |
| [`documents`](./documents/README.md) | The documents grid and the `/docs/[id]` editor |
| [`drive`](./drive/README.md) | The drive |
| [`folders`](./folders/README.md) | Tabs (Vault, Notes) and nested folders (Documents, Drive) |
| [`sharing`](./sharing/README.md) | Connections, sending, and what arrived |
| [`settings`](./settings/README.md) | The Settings modal and its tabs |

### The rules the layout follows

- **A component file is named after the component it exports**, in PascalCase —
  `modal/ConfirmDeleteModal.tsx`, not `modal/main.tsx`. The name is what appears in an editor tab,
  a stack trace and React DevTools; a folder of `main.tsx` files makes all three useless.
- **A shared folder has an `index.ts` barrel**, so a screen imports `@/components/modal` rather than
  reaching into the folder. A domain folder has none: a domain is imported by the one or two files
  that mount it, by file.
- **Imports across folders use the `@/components/…` alias; imports inside a folder are relative.**
- **Code moves into a shared folder once two domains draw the same thing.** The Vault and Passwords
  tables, the five hand-written dialog footers and the three copies of the tile checkbox are why
  `item-list`, `modal` and `tiles` exist. A shape one screen uses stays in that screen's folder.
- **Shared folders never import a domain folder.** `ui` imports nothing but `lib`; `modal`, `item-list`
  and `tiles` import only `ui`. A kit that needs the session is a domain component in disguise.

## The token layer

Every colour, type step and shadow is a Tailwind v4 `@theme` token in
[`globals.css`](../app/globals.css). Components name tokens (`bg-surface`, `text-ink-muted`,
`border-line`, `shadow-card`) and never raw palette values, so a palette change is one file.

The palette is the Cryple design system as `cryple.io` uses it, with the three adjustments that
system itself flags for text-dense surfaces:

- **Brand indigo `#6366f1` is not a text colour on light grounds** (4.47:1). `brand-500` is for
  fills, the logo and the active nav icon; `brand-600` `#4f46e5` carries filled buttons and
  `brand-700` `#4338ca` carries links and labels.
- **Status colours are the accessible pairs, not the decorative ones**: `success` `#047857`,
  `warning` `#b45309`, `danger` `#b91c1c`, each with its `-bg` and `-line` companion.
- **Grey is a four-step ink ramp**, `ink` `#1f2937` → `ink-soft` → `ink-muted` → `ink-faint`.
  `ink-faint` `#9ca3af` is 2.5:1 on white and is decoration only — never body copy.

Shape follows the same system: `rounded-lg` (8px) for buttons and controls, `rounded-2xl` (16px)
for cards, panels and modals, `rounded-full` for badges. Depth is three shadows — `shadow-card`
at rest, `shadow-raised` for a lifted control, `shadow-lift` for a hover lift or a modal.

**A block is not drawn at all.** `Card` has no border, no background, no shadow and no padding of
its own — it is a heading, an optional subtitle, and the content, in a `flex flex-col`. Blocks are
separated by whitespace and by their titles, not by panels. Everything sits directly on the ground.

This landed in two steps on 2026-09-12 and the first one was wrong: the border came off but the
white surface and `shadow-card` stayed, which just traded an outline for a raised panel. The
instruction was never "draw the box differently", it was "stop drawing the box". **A card is
positioning, not decoration.** With no panel doing the separating, spacing carries it: screens
stack at `space-y-8` and `PanelGrid` is `gap-8`, up from `5`.

The `flush` prop went with the padding. It existed to suppress `p-5` for tables and tile grids;
with no padding to suppress it meant nothing, so it was deleted rather than left as a prop that
does nothing.

What is still drawn is the stuff doing a different job: the sidebar and sticky-header rules, which
separate chrome from content scrolling underneath; input and secondary-button borders, which are
affordances; table row dividers, which are how rows stay scannable; and the thumbnail rings on
drive, note and document tiles, which frame an image rather than a panel. **Removing one of those
is not "consistency" — it is deleting a signal.**

**The note editor keeps `bg-surface`, and that is deliberate.** It is the area you type into, in
the same family as `Field` and `TextArea`, and those keep a light background because writing on the
grey ground is worse to read. Its shadow went, so it is a writing surface rather than a highlighted
panel. The documents editor's `.cryple-sheet` keeps its surface and shadow for the same reason and
one more: an A4 page is literally paper.

### One light theme, on purpose

There are no `dark:` variants and no `prefers-color-scheme` block; `:root` sets
`color-scheme: light`. The Cryple design system defines a light palette only, and inventing a dark
one here is exactly the drift it was written down to stop. Because components name tokens rather
than colours, adding dark mode later means redefining the token block under a media query — not
touching a component.

## Product boundaries this shell respects

Taken from [AGENTS.md § Product boundaries](../../AGENTS.md); each of these is an absence, so it is
recorded here rather than being visible in the code:

- **No session list or "sign out all devices".**

## Nothing here is blocked any more

Two screens used to surface an unresolved backend spec gap rather than hide or fake it, and both
are now closed:

- **Vault items** (`KekNotSpecifiedError`) — Decision A landed 2026-08-08, wired in 2026-08-10.

**Both were built as though they already worked**, against the real calls rather than as disabled
placeholders, so in each case the seam ceasing to throw was the entire change — no UI edit. That
is the pattern to repeat the next time a spec gap blocks a screen: build the screen, throw in the
seam, and let the fix be one file.
