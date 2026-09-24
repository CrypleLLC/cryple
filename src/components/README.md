# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation, cross-tab handoff |
| `AppProviders.tsx` | Mounts `CrypleProvider` in the root layout so every route shares one session |
| `SessionGate.tsx` | The loading / onboarding / locked / ready switch, wrapped around each route |
| `Onboarding.tsx` | Sign up (phrase, PIN, Standard or Paranoid, recovery kit) and adding this browser with a phrase, including *I lost my devices* and the too-many-devices picker |
| `Unlock.tsx` | PIN unlock through the server's OPRF, with the attempts left, and *I forgot this browser's PIN* |
| `AppShell.tsx` | Task 25 — the sidebar shell and navigation registry |
| `VaultScreen.tsx` | Vault index, add/delete secrets (Task 34) |
| `VaultReveal.tsx` | The vault's global show/hide-values state and its top-bar button |
| `NotesScreen.tsx` | The notes file grid, selection and batch delete |
| `NoteEditor.tsx` | One note open — autosave, delete, WYSIWYG formatting |
| `NoteEditorToolbar.tsx` | The editor's formatting controls |
| `note-surface.ts` | DOM ↔ note document, for the `contentEditable` surface |
| `DocumentsScreen.tsx` | The documents grid of page miniatures — opens each document in its own tab |
| `DriveScreen.tsx` | The drive: file grid, drag-and-drop upload, progress, download, selection and delete |
| `UsernameScreen.tsx` | The Settings **Username** tab — one panel, `UsernameCard` |
| `PinScreen.tsx` | The Settings **PIN** tab — this browser's PIN, turning Paranoid on, changing the account PIN |
| `DevicesScreen.tsx` | The Settings **Devices** tab — the account's devices, names, chain verification, removing another device with the phrase |
| `AccountScreen.tsx` | The Settings **Account** tab — deleting the account with the phrase (and the account PIN on Paranoid) |
| `SharingScreen.tsx`, `ConnectionInvitation.tsx`, `ShareItemDialog.tsx`, `SharedScreen.tsx` | Invitations and fingerprints, nicknames, sending, and what arrived with *Copy to my own account* ([`lib/sharing`](../lib/sharing/README.md)) |
| `UsernameCard.tsx` | The rename panel: the current name, the claim, and what a rename does |
| `StorageMeter.tsx` | The account's storage bar, in the sidebar corner — stored bytes solid, reservations behind them |
| `documents/DocumentWorkspace.tsx` | The `/docs/[id]` page: title, toolbar, A4 sheet, counts, save status |
| `documents/DocumentToolbar.tsx` | The TipTap formatting toolbar |
| `documents/DocumentOutline.tsx` | The heading navigation panel beside the sheet |
| `documents/pageBreak.ts` | The `pageBreak` node — the one page decision that is content |
| `documents/pagination.ts` | Measures the sheet and decorates where each page starts |
| `documents/useOutline.ts` | Debounced heading reads off the editor, and `goToHeading` |
| `documents/useDocumentSync.ts` | Binds `DocumentSync` to a component's lifetime |
| `documents/extensions.ts` | The TipTap extension set, bound to the document's `Y.Doc` |
| `ui.tsx` | Card / Button / IconButton / Field / PinField / TextArea / Select / Badge / Notice / Empty / Modal / SizeStepper / CopyButton / SecretField primitives. `SecretField` masks what is typed without making it a password field ([`lib/app`](../lib/app/README.md#a-secret-is-masked-while-it-is-typed)). **Every PIN entry is a `PinField`**, never a `Field` with `type="password"`: it carries `pinInputAttributes` so the browser's password manager neither saves nor autofills the PIN ([`lib/app`](../lib/app/README.md#a-pin-is-not-a-password-the-browser-may-keep)). `Field` and `TextArea` turn spellcheck, grammar extensions and translation off by default, and `CopyButton` clears the clipboard after 30 s — both in [`lib/app`](../lib/app/README.md#plaintext-the-browser-would-otherwise-send-away) |
| `icons.tsx` | The stroke-icon set shared by navigation and primitives, plus `FileTypeIcon` — the drive's filled, per-type file glyph |
| `StagingBanner.tsx` | The walking red warning banner, dev-only — see [`app`](../app/README.md#the-staging-banner) |

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

#### The username panel is its own Settings tab

It spent a while sharing a **Security** screen with the PIN upgrade, two unrelated panels side by
side under a word vague enough to cover both. They split on 2026-09-12 into **Username** and
**PIN**, which is what a person is actually looking for when they open Settings — you go there to
change your name or to turn the PIN on, never to visit "security". `UsernameScreen` is a one-line
wrapper around `UsernameCard` and exists only to give the tab a panel of its own; `PinScreen` holds
what was the rest of `SecurityScreen`.

Neither uses `PanelGrid` any more. With the tab menu taking a column of the modal, one card in a
two-column grid would sit in half the remaining width with nothing beside it.

Everything the rename decides is in [`lib/app/username.ts`](../lib/app/README.md#renaming-the-account);
the component sends the claim, calls `refreshAccount` so the header avatar and name follow the
rename, and clears the field only on success. The two sentences about what a rename does are
rendered unconditionally, not behind a disclosure — they are the panel's reason for existing as
much as the field is.

A rename is signed by this device's key, with no PIN, in either mode.

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

### Reading widths are capped; miniature grids are not

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

### Panels

Content sits in white `rounded-2xl` panels with a 1px `line` border and `shadow-card`, on the
`ground` `#f9fafb` page. `Card` takes a `flush` prop for table and list content, which then runs
edge-to-edge inside the panel (rows carry their own horizontal padding), and an `actions` slot for
controls that belong to the panel's header. Panels that do not need the full width sit inside a
`PanelGrid` — a two-column grid from `md` up, a single stacked column on mobile. Grid items
stretch, so neighbours in the same row share a height and their borders line up regardless of how
much content each holds. Wide tables stay outside a grid.

An empty screen is still a panel: `Empty` renders an icon chip and one sentence, and its callers
wrap it in a `<Card flush>` so it lands on a surface rather than floating on the page ground. The
two editors do the same — the note surface and the `/docs/[id]` page are sheets, toolbar and
character count included, not bare text on the background.

Every interactive primitive carries a `focus-visible` brand ring.

### One light theme, on purpose

There are no `dark:` variants and no `prefers-color-scheme` block; `:root` sets
`color-scheme: light`. The Cryple design system defines a light palette only, and inventing a dark
one here is exactly the drift it was written down to stop. Because components name tokens rather
than colours, adding dark mode later means redefining the token block under a media query — not
touching a component.

## The modal primitive

`Modal` in `ui.tsx` is the one dialog. Before it, the only "are you sure" surface was an inline
`Notice` — which `DocumentsScreen` still uses for its delete confirmation, and which does not
scale to a scrollable checkbox list of the whole vault.

It is a three-part flex column at `max-h-[85vh]`: **header and footer are `shrink-0`, only the
body scrolls.** A footer that scrolls away takes the Save button with it, which on a long list is
the same as not having one.

**Everything decidable without a DOM lives in [`lib/app/modal.ts`](../lib/app/README.md#a-modal-minus-the-dom)**
— the Escape/Tab decision table, backdrop dismissal, and reference-counted scroll locking — so
those rules have tests, and what is left here is wiring: query the tabbables, read
`document.activeElement`, call `focus()`, set `body.style.overflow`. Same split as
`note-surface.ts` and `lib/note-format`.

The two pieces that can only live here:

- **Focus restore captures the trigger on mount**, before focus moves into the dialog, and returns
  it on unmount. Reading it later would restore focus to the dialog's own close button.
- **Opening focuses the first tabbable, or the dialog itself when it has none** (`tabIndex={-1}`
  exists for that case alone), so the next Tab starts inside and a screen reader announces the
  dialog rather than whatever was behind it.

Verified in a browser rather than asserted, since none of it is reachable from the node-environment
test suite: `aria-modal` and `aria-labelledby` resolving to the title, focus entering on open, the
body locking, Tab walking the controls and wrapping at the end, Tab from outside being pulled back
in, Escape closing, focus returning to the trigger, and the lock releasing. The one path not
exercised is a mouse drag from inside the dialog to outside it.

## The account menu, and what lives in Settings

The sidebar holds the **places you keep things** — vault, notes, documents, drive. Everything about
the account itself lives behind the avatar in the top right: clicking it opens a menu with
**Settings** and **Remove this browser**.

**Lock is not in that menu**, and that is deliberate. It sits as its own button immediately to the
left of the avatar, because it is the one control a person reaches for in a hurry — someone walking
up behind them. A control you need in two seconds does not belong two clicks deep. It is always
there, because the device record survives a lock.

**Settings is a modal with tabs**, `SETTINGS_TABS` in `lib/app/settings.ts`. Sharing, Username and
Devices, Username, PIN and Account are the tabs (Sharing only on a device holding `sharing`), and it takes the `wide` variant to give them room. None of them is a place you
keep things, so none earned a permanent seat in the sidebar.

**The tabs are a vertical menu down the left edge of the modal, not a row across the top.** The
panels are settings pages of real height, and a horizontal strip above them reads as a step in a
flow rather than a place you can move between freely. Below `sm` the row collapses to a column, so
the menu sits above the panel as a horizontal strip again — a 400px-wide screen has no room for a
side rail.

**The modal is a fixed 40rem tall above `sm`, and the panel scrolls inside it.** Left to size
itself, it jumped between 516px and 735px as you moved between tabs — the close button and the menu
items walked up and down the screen under the cursor, which is what makes a tabbed dialog feel
unstable. 40rem is measured, not guessed: it clears the tallest panel, the Standard account's PIN
upgrade form at 622px, with room to spare. The cost is paid by the short panels, which show empty
space below them; that is the trade a fixed size *is*, and a menu that stays still is worth more
than a tight box.

The height lives on the two-column container, not on `Modal` itself, and the panel column carries
`sm:overflow-y-auto`. So content taller than the box — a Sharing tab with many connections —
scrolls **within** the panel while the menu stays put, and the dialog's own `max-h-[85vh]` still
shrinks the whole thing on a short viewport. Below `sm` none of it applies: the height is auto and
the modal body scrolls as it always did.

**The account's mode is read on the PIN tab, and nowhere else.** The header's account button used
to carry a `Paranoid` / `Standard` badge; it was removed on 2026-09-12. The mode is not something
you act on from the header — it changes in exactly one place, through a deliberate one-way upgrade
— so a permanent badge in the chrome spent a slot on a fact that is checked rarely and changed
once. The PIN tab says *PIN protection is on* when it is, and offers the upgrade when it is not,
which is the same fact in words that mean something and a control next to it. `AccountMenu` no
longer takes a `paranoid` prop at all, rather than taking one it ignores.

**But what arrived *is* a place you keep things, so it stayed in the sidebar.** `SharingScreen` in
Settings is only the relationships — invite, review, connect, disconnect. The items other people
sent you are the **Shared** tab, rendered as a tile grid like the drive, because that is what they
are to the person looking at them.

**It stacks in one column rather than a `PanelGrid`:** invite form, then anything waiting for you,
then the connections list. Side by side, the invite form and the list read as two equal choices
when they are really a sequence — you invite someone, they appear in the list. The single column
also gives the fingerprint comparison in `ConnectionInvitation` the full width it deserves, instead
of squeezing two 24-character codes and their accept/decline buttons into half a modal.

**Every connection in the list is checked against its pin on every load**, not only while an
invitation is under review. `SharingScreen` runs `verifyConnection` on each accepted connection and
each invitation this account sent, through `Promise.allSettled` so one failed lookup cannot hide
another row's alarm. A row that fails shows the reason under it, and a changed key or account also
gets a *Do not send* badge. A lookup that fails outright shows nothing on the row; a send still
fails, because it runs the check again.

**`ShareItemDialog` does not check up front, and does not need to.** The refusal lives inside
`shareItem` and `shareItemById`, so no caller can skip it; the dialog only turns a
`ConnectionNotTrustedError` into `sendRefusal`'s sentence. `ConnectionInvitation` uses the same
check and disables *Accept* while it shows an alarm, so a changed fingerprint can never be accepted
into a new pin. See `lib/sharing/README.md` § Checking a connection against its pin.

### Shared reads every tile before it can draw one

A shared tile shows a real name — a filename, a note title, a secret's name — and none of those
reach the server in clear. `describeReceived` derives the connection key, unwraps the item's DEK and
opens the payload for **each** arrival, which is why the screen has a loading state where the other
grids do not. A share whose connection is gone, or whose payload will not open, renders as
*Unreadable* and is not clickable rather than disappearing.

**A tile carries a name and a body, and they are not the same string.** `describeReceived` takes a
view function per text type rather than reading the payload itself, because what a payload *is* is
app knowledge, not sharing knowledge: `sharedSecretView` in `lib/app/sharing.ts` names the tile
after the secret's `name` and shows only its `value`, while `sharedNoteView` titles the tile from
the first line and shows the whole note. Returning the raw plaintext for both is the bug this split
fixes — a secret's plaintext is a JSON envelope, and the reader was shown
`{"name":…,"value":…}` where the value belonged.

### Sharing is a per-item control, not a selection-mode one

Every item that can be sent carries its own share affordance: a `SharingIcon` button on each drive,
note and document tile, and an icon-and-label button on each vault row. All four open the same
`ShareItemDialog`.

**It used to live in the selection toolbar, disabled unless exactly one item was selected**, which
put a single-item action behind a multi-select gesture and hid it from anyone who never pressed
*Select*. Selection mode still exists for deleting in bulk; sharing is not a bulk action and no
longer pretends to be. A tile whose payload did not decrypt cannot be shared — its DEK is what would
travel, and sending one that does not open just reproduces the failure on the far side.

**`ShareItemDialog` is a `Modal`, not a card on the screen behind it.** It used to render inline,
which pushed the grid or table down the moment you pressed share and left you reading a form in the
middle of a list. It is a focused, one-item task with an obvious end, which is exactly what the
modal primitive is for — it traps focus, closes on Escape or backdrop, and restores focus to the
share button you came from. It carries no explicit *Close* button because the modal header has one.

**The dialog states no rules.** One sentence covers sharing's consequences — *anything you send can
be copied by the person you send it to* — and it is read once on the invitation card in the Sharing
settings tab, where you decide to trust someone, not reprinted on every send where it becomes
furniture nobody reads. The two further rules that once appeared here (deleting your original breaks
their copy; removing a share cannot un-read it) were cut on 2026-09-12 for the same reason; see
`lib/sharing/README.md` § What the UI must never claim for what still holds regardless.

## Session custody

`CrypleProvider` owns the one `SessionKeystore`, the one `TokenStore` and the device record store
(IndexedDB). Its phase is `loading → onboarding | locked → ready`: `locked` when a device record
exists, `onboarding` when none does. The flows themselves are [`lib/account`](../lib/account/README.md);
the provider maps their outcomes to sentences and phases.

- **Unlock once, sign from memory.** The OPRF round trip and the Argon2id derivation are paid at
  unlock; the device key and the scope KEKs stay in the keystore for the session.
- **The token renews itself.** Five minutes before it expires, the device signs in again. A
  `401 UNAUTHORIZED` from any call triggers the same silent sign-in; if that is refused, the
  device was removed, the local record is forgotten and the phrase is asked for.
- **A chain that does not verify** from the root key at unlock raises a danger notice across the
  shell, and the devices screen refuses to remove anything until it does.
- `holds(scope)` and `fullDevice` come from the session's scopes. The navigation hides a section
  whose scope the device lacks, and delete buttons need a full device.
- The provider subscribes to `session.onLock()`, so the idle lock drives the UI back to `locked`.

`reportError` is the single funnel for failures: `userMessageFor(error, { deviceScopes })`,
copy built client-side from the `code`.

## Onboarding

`createAccount` keeps the drafted genesis across a failed attempt, so a retry sends the same
batch; it discards the draft after an authentication refusal. The phrase stays in onboarding
state only until the recovery kit step is finished. `enrolBrowser` maps its outcomes to *no
account uses this phrase* (with *Create an account with this phrase*), the too-many-devices
picker, or a message.

Neither opens the vault on its own: the component calls `enterVault` immediately after adding a
browser, and after the recovery kit has been downloaded for a sign-up
([`lib/app` § Onboarding](../lib/app/README.md#onboarding)).

The PDF is built by [`lib/recovery-kit`](../lib/recovery-kit/README.md), loaded with a dynamic
`import()` on the first click so `pdf-lib` and the QR encoder stay out of every other page load.
The download uses the same object-URL-and-anchor approach as the drive, and the URL is revoked
straight after the click. The phrase can be revealed on the step but has no copy button.

The PIN step presents Standard and Paranoid as a real choice, and shows the one-way,
no-reset warning as soon as Paranoid is picked, before the account is created. There is no
"disable Paranoid" control and there never will be.

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

## Why the vault list downloads every payload

**Names are ciphertext.** A secret's plaintext is one `{name, value}` JSON blob, so the server
holds no name field to list — `GET /secrets?fields=meta` returns sizes and timestamps and
nothing a person can read. Showing names in the index therefore means opening every item, and
the list loads through `listSecrets` — the single unpaginated `GET /secrets` the endpoint guide
calls "the heaviest response the API produces" — rather than the meta listing plus one
`GET /secrets/{id}` per row. One request beats N, and the values are then already in memory.

Hiding is consequently presentational only: the global toggle in the top bar flips a boolean,
never a fetch, so it is instant in both directions and costs nothing to use. Names stay visible
at all times; only values mask, and they mask to a fixed-width `MASKED_VALUE` so the rendering
does not leak the length. Copy stays available while values are hidden — the point of hiding is
shoulder-surfing, not withholding the value from its owner.

An item that will not decrypt is rendered as `UNREADABLE_SECRET_NAME` and keeps its row instead
of failing the whole list, since one blob written by another client must not blank the vault.
`buildVaultRows` in [`lib/app`](../lib/app/README.md) does that classification, so it is tested
without a DOM.

## Notes is the one populated screen with no panel

`NotesScreen` is a section like Vault or Documents — same `NAV_ITEMS` entry, same top bar — but
once it has files it deliberately **does not wrap them in `Card`**. The tiles render straight into
the content column with no panel border around them, because a panel exists to group controls, and
a file browser's content *is* the grouping. A border there would read as a second, redundant frame
around a grid that already has visible objects in it.

The empty state is the exception, and takes a `<Card flush>`: with no objects on the page there is
nothing for the eye to land on, so the message needs a surface of its own. Documents does the same.

The tiles themselves are not borderless. Each is a page-shaped thumbnail (`aspect-[3/4]`) with a
`shadow-card` and a hairline ring, carrying the note's real first ~420 characters at 9px under a
bottom fade, with the title and date beneath it as a filename. Hovering lifts the tile
(`-translate-y-0.5`, `shadow-lift`) and warms the ring to `brand-200`. That reads as a stack of
paper rather than as a list of rows — the ring belongs to the object, not to the section. A note
that will not decrypt shows the notes glyph instead of content, keeping its tile.

### Selecting files

The grid supports a multi-select for batch delete, entered either from the **Select** button in
the toolbar above the grid or by ticking a checkbox directly — the checkbox is invisible until
the tile is hovered, then persistent once selection mode is on, which is what keeps the default
view clean while still working on touch, where there is no hover.

While selecting, a **tile click toggles instead of opening**. That is the OS file-manager idiom,
and without it a batch of ten means ten precise hits on a 20px checkbox.

The checkbox is a **sibling** of the tile button, not a child: the tile is already a `<button>`,
and nesting one inside it is invalid HTML that browsers silently reflow. Positioning it against
the `<li>` (`group relative`) keeps both independently clickable and independently focusable. It
is a `role="checkbox"` button with `aria-checked` rather than a native input, so its appearance
comes from the same design tokens as everything else; the selected tile also takes a
`ring-2 ring-brand-500` in place of its hairline, so selection is legible without relying on the
20px control alone.

The toolbar is borderless like the rest of the section, and doubles as the count readout —
`12 notes` normally, `3 selected` while selecting, in an `aria-live` region. The new-note FAB
**hides during selection**, so the corner does not offer "create" and "delete" at once.

Deleting asks first, through the same confirmation `Notice` a single delete uses, and then
reports only if the server deleted fewer notes than asked —
[`batchDeleteSummary`](../lib/app/README.md#selecting-notes-for-a-batch-delete) returns nothing on
a clean run, because the notes are visibly gone. `DELETE /notes` takes the whole selection under
**one** signature, so a batch of twenty costs one signed action rather than twenty; the sorting
rule that signature depends on is in
[`lib/notes`](../lib/notes/README.md#deletenotes--one-signature-for-the-whole-selection).

The selection is pruned against the reloaded list on every load, so a note deleted elsewhere
cannot stay checked in a grid that no longer draws it.

**One screen, two views, no route.** `NotesScreen` holds a `view` union
(`{mode:'list'} | {mode:'note', id?}`) and swaps what the section body renders; there is no
router involved, matching the rest of the shell. Opening a tile replaces the grid with the
editor, whose own header carries the back arrow, the live title (the first line of the draft)
and the actions. Going back reloads the list.

The **new-note button is `fixed bottom-6 right-6`**, not a header action, and it renders only in
list view. It opens a blank editor immediately rather than prompting for a name — the first line
becomes the name, so there is nothing to ask.

Editing lives in **`NoteEditor.tsx`**, its own component rather than a helper inside the grid
screen, with `NoteEditorToolbar.tsx` beside it. The two screens share nothing but props: the grid
knows how to list and select, the editor knows how to open one note. Every formatting rule sits
further out again, in [`lib/note-format`](../lib/note-format/README.md), so the editor decides
*when* to apply a change and never *what* the change is.

### The editing surface

The writing surface is **WYSIWYG**: a `contentEditable` div with no border or ring of its own,
inside a white sheet that also holds the formatting toolbar above it and the character count
below. Bold text is bold, a title is a real heading, a checklist has real tick boxes. The user
never sees a `#` or a `**` — that spelling is only how the note serializes.

`note-surface.ts` is the DOM half, and it is deliberately the *only* untested file in the
feature: everything decidable without a DOM lives in
[`lib/note-format`](../lib/note-format/README.md), which is why that module has 30 tests and this
one has none (the repo's Vitest is node-environment by design). What is left here is three
functions — read the surface into blocks, find the block at the caret, find the blocks a
selection spans.

The surface holds **one `<div data-line="…">` per line**, styled entirely from that attribute by
CSS in [`globals.css`](../app/globals.css). Bullets and tick boxes are `::before`
pseudo-elements rather than nodes, so the caret cannot land inside one and serialization never
has to skip one. Ticking a box is a single `data-checked` flip — the text and the caret do not
move.

**But a direct child of the surface is not always one of those divs.** `contentEditable` leaves
the first thing typed into an empty surface as a bare text node, with no wrapper, until the
browser has a reason to make one. `readSurface` already expects this and folds such loose text
into an implicit `text` block. `surfaceBlockAt` therefore **returns `undefined` rather than that
text node** — its contract is "the line *element* at the caret", and a caller that gets a text
node back reads `.dataset.line` off `undefined` and throws on every keystroke. That was a real
bug, fixed 2026-09-09; the `nodeType === Node.ELEMENT_NODE` check on its last line is the whole
fix and is not redundant.

Every caller already handles `undefined` by doing nothing, which is the right answer for a line
that has no element to carry `data-line`: the toolbar reports it as `text` (which is what
`readSurface` calls it too), and Enter, the tick-box click and the line-type buttons pass. **The
one visible consequence is that the line-type buttons do nothing on the very first line of a
brand-new note**, until an Enter or a paste gives that line a wrapper. Closing that means
promoting loose text into a real block on `sync`, which is an editing change rather than a fix,
so it has not been done.

Five things this depends on, each of which breaks the editor if it is wrong:

1. **React must never own the surface's children.** The initial HTML is assigned imperatively in
   a mount effect; the JSX has no children and no `dangerouslySetInnerHTML`. This is not
   defensive style — with `dangerouslySetInnerHTML` React 19 re-applies the HTML on *every*
   render, and since every keystroke calls `setDraft`, the document snapped back to its opening
   content on each key. It was found by driving the real thing in a browser, not by any test.
2. **`onMouseDown` is prevented on every tool button.** Otherwise mousedown moves focus out of
   the surface and collapses the selection *before* the click handler runs, so Bold would style
   nothing.
3. **Bold and italic go through `document.execCommand`.** It is deprecated and has no
   replacement; the alternative is hand-rolled range splitting across partially-selected nodes.
   Browsers disagree on what it emits, so `note-surface` reads `b`/`strong`/`font-weight` and
   `i`/`em`/`font-style` alike when serializing.
4. **Enter is mostly left to the browser.** Chrome clones the current block, so a list continues
   as a list — which is what you want. The handler only corrects two cases: a fresh task line is
   forced to unticked, and pressing Enter on an *empty* topic or task line exits the list instead
   of extending it.
5. **Paste is forced to plain text.** Without it, pasted HTML would inject arbitrary elements and
   styles into a document whose serializer expects a flat block list.

### The toolbar

Three groups: line types (Title / Topic / Checklist), inline styles (Bold / Italic), and font size
(A− / A+ with the current size between them). No font picker and no size field — the scale steps
from 12 to 24, and the buttons disable at each end rather than appearing to do nothing.

Title and Topic show as pressed via `aria-pressed`, tracked from the block under the caret.
Checklist is a cycle (open → done → off), so it is not a binary state and its tooltip says so.

**A− / A+ size the selection, or the current line when nothing is selected** — size is inline
formatting stored in the note, exactly like bold, not a setting for the whole document. The number
between the buttons is the size *at the caret*, refreshed by the same `sync` that tracks the line
type, so stepping twice actually walks 14 → 16 → 18.

Applying it leans on the browser's own range splitting, because a selection can start and end
mid-node: `execCommand('fontSize', …, '7')` with `styleWithCSS` produces a sentinel
`font-size: xxx-large` wrapper, which `applyFontSize` then rewrites to the real px value. The
selection is restored **inside** the new spans (`setStart(span, 0)`), not around them — anchoring
outside leaves the caret in the parent, where the size lookup finds nothing, and the toolbar reads
the default forever while every press recomputes from 14. That was a real bug, caught by driving
the browser.

### Autosave, and the four things that keep it honest

**There is no Save button.** Writing happens two seconds after the user stops typing, and the
header carries a status word (`noteSaveState` in [`lib/app`](../lib/app/README.md#the-save-gate))
where the button used to be, in an `aria-live="polite"` region so the change is announced rather
than only seen. Below `sm` the status moves next to the character counter, which is the only
place there is room for it.

The debounce is one effect, not a stored timer:

```tsx
useEffect(() => {
  if (unreadable || !isNoteSavable(draft, saved)) return;
  const timer = setTimeout(() => void save(draft), NOTE_AUTOSAVE_DELAY_MS);
  return () => clearTimeout(timer);
}, [draft, saved, unreadable, save]);
```

Every keystroke changes `draft`, so React's cleanup cancels the previous timer — that *is* the
debounce. It also gives the trailing edge for free: when a save finishes, `saved` changes, the
effect re-runs, and if the user typed during the write the guard is true again and a fresh timer
starts. A failed save leaves all three dependencies untouched, so it does **not** reschedule
itself; the error notice stands and the next keystroke retries. That is deliberate — the API
guide is explicit that auth fails closed and must not be hammered.

Four things this depends on, none of them optional:

1. **The note's UUID is generated once**, when the blank editor mounts, and passed to every save.
   Autosave turns "`POST /notes` without an `id` is not idempotent" from a footnote into a live
   duplicate-note bug. `saveNote` in [`lib/notes`](../lib/notes/README.md#savenote--one-call-the-autosave-loop-can-fire-repeatedly)
   also answers a `200` create-or-return with a `PUT`, because create-or-return would otherwise
   silently discard everything typed after a timed-out first save.
2. **`inFlight` is a ref, not state**, so the check and the set happen in the same tick. Two
   overlapping writes to a not-yet-created note would both `POST`.
3. **`onClose` and `onSaved` are `useCallback`-stable** in the parent. Inline arrows would give
   the effect a new `save` identity on every parent render, resetting the countdown — an
   autosave that never fires while the user is still typing is the failure mode, and it is
   invisible in testing.
4. **Back is disabled while a write is in flight**, and otherwise flushes: `close()` awaits a
   final `save` before calling `onClose`. Between the two, no keystroke can be dropped by
   leaving the screen mid-debounce.

The screen holds the returned `NoteRecord`, so every save after the first is a `PUT` that reuses
that record's DEK — the component never constructs a `wrapped_dek` itself, which is what keeps the
note openable across edits (see
[`lib/notes`](../lib/notes/README.md#the-dek-must-survive-the-edit)).

Delete is the only notes action needing the seed key, and it is **two-step**: the button reveals
a confirmation that says the deletion also removes the note from anyone set to inherit it,
because the server destroys those `inheritance_shares` rows in the same transaction and the
response does not report how many went with it. Vault's row Delete is one-step by comparison;
this one guards a longer piece of writing.

A note that will not decrypt opens read-only, with **saving disabled**, so a re-seal cannot
overwrite content this device could not read in the first place.

## The drive screen

Everything decidable without a DOM is in [`lib/app/files.ts`](../lib/app/README.md) with tests —
byte formatting, file kinds, the storage bar, and **every string that makes a durability claim**.
The component is wiring.

Three rules the copy has to keep, and each has a test asserting it rather than a reviewer
remembering it:

- **Never claim two providers.** Replication is asynchronous, so for up to a minute a file is real
  and exists in one place. `replicationLabel` says *"Saved. A second copy is made within a minute"*
  until `gcs_state` is `ok`, and the test asserts the pending string contains neither "two" nor
  "provider". A failed replica gets its own line rather than hiding behind the happy one.
- **A file opens the moment R2 has it.** `isOpenable` keys on `r2_state`, not on the replica —
  waiting for `gcs_state` would make the product feel a minute slower than it is for no gain.
- **Deleting does not free space immediately.** The row keeps its bytes until the reconciler removes
  both copies, so `fileDeleteConfirmation` and `storageFullMessage` both say when the space returns.
  A user who deletes a file and then hits the ceiling would otherwise think the product is broken.
- **The bar draws what R2 holds, never what has been reserved.** `GET /files/usage` answers with two
  sums: `stored_bytes` (`r2_state = 'ok'`) and `used_bytes`, which also counts the `pending` rows the
  ceiling is checked against. Filling the bar with the second would show space consumed by files
  that do not exist — an upload that died at its first part would look like a stored file. Showing
  only the first would be a different lie, because the account can be refused an upload while the
  bar shows room. So `storageBar` returns both: a solid fill for what is stored and a quieter
  segment for what is merely held, with `uploadingSummary` naming it. `nearlyFull` keys on
  `used_bytes`, because that is the number that will refuse the next upload.

Selecting files and deleting them together works exactly as it does in notes — the same checkbox,
the same toolbar readout, the same rule that a tile click toggles while selecting — and the shared
reasoning is under [Selecting files](#selecting-files) rather than repeated here. Two things are the
drive's own:

- **An unfinished upload is selectable even though it cannot be opened.** Its tile is disabled for
  download and stays live for selection, because a row that holds quota with nothing behind it is
  precisely the one a user needs to clear.
- **An unfinished upload can also be finished, usually in one click.** Its tile carries an upload
  glyph instead of the download one. Where the browser can hand out file handles the app kept one
  when the upload started, so the click resumes straight away; where it cannot — Firefox, Safari —
  the same click asks for the file back. The tile's tooltip says which of the two will happen, so
  the control is never a surprise. Picking or reopening the wrong file is refused by `lib/files`,
  not by the component, and the refusal lands in the transfer list like any other failed upload.
- **A transfer is reported on a tile and nowhere else.** A progress line runs along the bottom of
  the miniature and the status line under the name counts up in place of whatever it said before.
  There is no separate list above the grid — one upload was otherwise reported in two places, and
  the tile is the place the user is already looking.
- **An upload gets a tile before the server has a row.** `send` mints the id up front, so a
  placeholder tile is drawn from the `File` itself — name, size, kind — and the real row replaces it
  when the listing reloads. That is why a first upload animates the same way a resume does; before
  it, the very first upload of a file was the one case with nothing to watch.
- **The label matters most on a resume**, because the line it replaces reads *"This upload never
  finished, so the file is not in your vault"*. Leaving that in place while bytes are moving tells
  the user the opposite of what is happening.
- **A failure that stored nothing gives its reservation back on the spot.** `POST /files` reserves
  the declared size before any URL is signed, so an upload that dies at its first part would hold
  the whole file's worth of quota until a sweep ran a day later. `send` watches `doneBytes`: if no
  part was ever confirmed it abandons the row, and what stays on screen is a notice with nothing
  behind it. **A failure that did store parts keeps its row**, because those bytes are what makes
  resuming worth doing — the user decides, with Resume and Discard on the tile.
- **A failed transfer keeps its tile** — a red line where the progress was, the reason under the
  name over up to three lines, and a close control that is always visible rather than waiting for a
  hover. Dismissing forgets the notice; it does not touch the row on the server. A placeholder whose
  upload failed before any row existed (too large, over quota) disappears with it.
- **The trash control means two different things, and says so.** On a stored file it is the signed
  `file-delete` and the confirmation talks about permanence. On an unfinished upload it is the
  JWT-only abandon: nothing was stored, so there is nothing to warn about losing, and the
  confirmation says the space comes back at once instead. Same button, different sentence, because
  the two actions destroy different things.
- **A transferring or placeholder tile is inert**: not openable, not selectable, controls hidden.
  Every one of those actions would race the upload the tile is showing, and a placeholder has no
  row behind it to act on.
- **The transfers themselves do not live in this component.** `AppShell` renders only the active
  section, so opening Notes unmounts the drive and would take every in-flight upload's progress with
  it — the upload kept running, invisibly, and coming back showed a file that looked stalled. They
  live in [`lib/app/transfers`](../lib/app/README.md#uploads-outlive-the-screen-that-started-them)
  and are read with `useSyncExternalStore`, so the screen is a view of them rather than their owner.
- **The summary line matters more here than in notes, and it is not an error.** The screen's one
  message slot carries a tone, because *"Deleted 2 of 3 — 1 file was already gone"* rendered in the
  danger colour reads as a failure and contradicts the copy's whole point. A shortfall is `info`; a
  thrown request is `danger`. `fileBatchDeleteSummary` stays silent on a clean run, since the tiles
  are visibly gone. The storage bar reloads with the grid, so the reclaimed space lands in the same
  paint.

**An image tile shows the image.** The preview is a thumbnail file of its own, fetched and decrypted
like any other download and held as an object URL in `lib/app/previews` so a return trip to the
drive does not fetch it again — and, since 2026-09-11, kept as sealed bytes in OPFS
([`lib/files/cache`](../lib/files/README.md#the-cache-holds-ciphertext-and-that-is-the-whole-design))
so a *reload* does not fetch it either. It is drawn with a plain `<img>`, and `next/image` is disabled for
this file in the lint config rather than worked around: the optimiser fetches the source
server-side, and this source is a `blob:` of bytes that only exist decrypted in this tab. A file
with no preview — not an image, an undecodable type, a browser without `OffscreenCanvas`, a
thumbnail upload that failed — falls back to the type glyph, so nothing waits on a preview that is
never coming.

### The drive tile is an icon, not a page

Notes and documents are **pages**, so their tile is an A4 miniature of the page: the content is the
thumbnail. A drive holds a `.zip`, a `.docx`, a 4 GiB video — things with no page to draw — and
until 2026-09-11 they were drawn at that same A4 size anyway, five to a row, each one a huge sheet
of paper with a small glyph floating in the middle of it. A `.zip` is not a document, and sizing it
like one wastes most of the screen on empty paper.

So the drive alone uses the **desktop file-manager shape**: a square icon, the name centred under
it over up to two lines, one line of caption under that.

- **A file with a thumbnail shows it at its own aspect ratio.** The image is `object-contain` inside
  a square of the glyph size, so a portrait photo stays portrait and a landscape one stays
  landscape — the box is a ceiling on the longest edge, not a shape imposed on the picture.
  `object-cover` was the previous behaviour and it centre-cropped every photo to A4.
- **Everything else gets a type icon.** `FileTypeIcon` in [`icons.tsx`](./icons.tsx) draws one sheet
  with a folded corner, a mark saying what kind of thing it is, and a coloured band carrying the
  extension — the shape a desktop uses, for the reason a desktop uses it: the extension is the
  fastest identifier a user has, and the colour is what makes a wall of them scannable. The kind
  comes from the MIME type via `fileKind`, which now separates the office families (`document`,
  `sheet`, `slides`) and `code` rather than dropping all of them into `other`, because those are
  exactly the files a drive is full of and an icon that cannot tell a `.docx` from a `.zip` is not
  doing its job. The band's label comes from the **name**, not the type — `fileExtension` is what a
  file manager shows, and it stays empty rather than guessing when the suffix is missing, long, or
  not plain alphanumeric.
- **A glyph the browser could not decrypt is the generic sheet** — grey band, no mark — which is
  precisely what an OS shows for a type it does not know. The caption already says the file is
  unreadable; the icon does not need to say it twice.
- **The icons on the miniature are the ones that had to shrink.** The checkbox and the hover actions
  moved to the tile's corners at `h-5 w-5`, because at the smallest step the whole tile is 96px and
  the old 24px controls at `inset-3` did not fit inside it.
- **Icons bottom-align within their box.** A landscape thumbnail is shorter than a portrait one, and
  aligning them on their tops would leave a ragged row of names.

### The size control

`SizeStepper` in `ui.tsx` — a `−` and a `+` either side of the current step's
name — sits in the toolbar immediately before Select / Cancel / Delete and Upload, the same place a
file manager puts it and next to the other things a user does to a whole grid. **All three grids
use it**: the drive, notes and documents. Everything it decides is data in
[`lib/app/icon-size`](../lib/app/README.md#how-large-the-three-grids-draw-themselves), including the
`grid-template-columns` the grid is given; the component only holds which step is current and writes
it back.

Its labels are props rather than fixed strings, because *"Smaller icons"* is wrong on a screen full
of note previews — notes say *"Smaller notes"*, documents *"Smaller documents"*. The four step names
underneath are shared, since they are the same four steps.

The control is hidden when the grid is empty — there is nothing to resize, and the empty state is
already carrying the instructions.

### What moved off the miniature

The size used to be a pill floating over the bottom of the A4 sheet. At 48px it would cover the
thumbnail it sits on, so it moved to the caption line, and `fileCaption` decides what that line
says: the size, **unless the status still has a durability claim to make**. `REPLICATION_DONE` is
the one state with nothing left to say — the file is stored, twice, and a grid of forty tiles each
repeating *"Saved, with a second copy"* is noise. Every other state keeps the line: pending
replication, a failed replica, a file being repaired, an unfinished upload. The full status stays
in the tile's `title` in all cases, so nothing is lost, only unsaid. A test pins both halves.

**The bar is not part of this screen.** It lives in the sidebar's bottom corner, drawn by
`StorageMeter` from a shared `lib/app/usage` store: it is an account-level fact, not a drive-screen
fact, and a user who is about to upload something is often looking at another section. The drive
publishes each reading it takes; the meter fetches one itself if it mounts before the drive is ever
opened. The account chip moved the other way, from that corner to the top bar next to Lock and Log
out, where the rest of the identity chrome already is.

`FILES_ENABLE` is off by default, so `/files` answers `404` on a deployment without R2. That is not
an error worth showing a user: `ApiError.isDriveDisabled` turns it into "the drive is not switched
on for this deployment".

## Document and note tiles

Both grids render a **file**, not a card: a paper miniature of the content, then the title and a
date underneath, with a selection checkbox that appears on hover. `NoteFile` and `DocumentFile` are
deliberately the same shape, because the two screens sit next to each other in the same navigation
and a reader should not have to learn two layouts.

**Both grids resize**, with the same `SizeStepper` the drive uses and the reasoning in
[`lib/app/icon-size`](../lib/app/README.md#how-large-the-three-grids-draw-themselves). The step sets
the column width, which for a page grid *is* the page width — the miniature is `w-full` inside it
and its aspect ratio does the rest. Everything inside the page is expressed as a share of the page,
so scaling one scales all of it: the margins already were (`12%` / `8.5%`), and the body text, the
inner title, the bottom fade and the undecryptable-page glyph now are too. A miniature that kept
9px text on a 264px page would stop being a scale drawing and start being a box with small writing
in it.

The document miniature differs from the note's in the three places where a document is not a note:

- **A4, not 3:4.** `aspect-[210/297]` is the real page ratio, and the padding is `12%` / `8.5%` —
  the 25.4mm margin expressed as a fraction of the page, so the miniature is a scale drawing of the
  sheet rather than a box with arbitrary inset.
- **The title is rendered inside the page** when there is one. A note has no title of its own — its
  first line is its title, so drawing it twice would be a lie about the content. A document's title
  lives in `meta.title`, separate from the body, so the miniature shows it exactly where the real
  first page does. `UNTITLED_DOCUMENT` is skipped, because a placeholder is not content.
- **A bigger text budget.** `DOCUMENT_THUMBNAIL_MAX_CHARACTERS` is 1200 against the note's 420: the
  page is taller, and long-form writing is the point, so a miniature that stops a third of the way
  down reads as an empty document rather than a full one. Overshooting is safe — the overflow is
  clipped and the bottom gradient covers the cut.

The date line keeps the documents' own `edited` label ("Edited 2 hours ago") rather than the note's
raw `toLocaleDateString`, since it already existed and says more.

## The document editor

The `/docs/[id]` surface is TipTap bound straight to the document's `Y.Doc`, so the editor holds no
content of its own: no `content` option, no `setContent`, no controlled value. Everything the
chrome displays — the outline, the word and page counts, which toolbar buttons are lit — is derived
from `editor.state.doc` on the fly, never written back. A stored attribute would be a sealed delta
appended on every device that opens the document, for a value the editor can recompute for free.
[`lib/documents`](../lib/documents/README.md) explains why that cost never goes away.

The editable body and the title field carry `PRIVATE_TEXT_ATTRIBUTES` / `PRIVATE_TEXT_PROPS`, so no
spelling, grammar or translation service sees the text, and **the tab title is never the document's
name** — it would land in synced browser history. Why, and what it costs, is in
[`lib/app`](../lib/app/README.md#plaintext-the-browser-would-otherwise-send-away).

### `useEditorState` must not read the editor out of its own snapshot

This is the trap that made the toolbar render blank on load, and it will bite again.

`useEditor` **does not re-render on transactions** unless `shouldRerenderOnTransaction: true` is
passed, so `editor.isActive('bold')` read during render is frozen at whatever it was when the
component last rendered for some other reason. Reading it that way gives a toolbar that never
lights up and undo/redo buttons that never enable. `useEditorState` is the supported fix: it
subscribes to transactions and re-renders only when the selected value actually changes, which is
also what keeps typing from re-rendering the whole workspace.

Its selector receives `{ editor, transactionNumber }`, and **that `editor` is not reliable**.
`EditorStateManager` caches its snapshot at construction and only rebuilds it when
`transactionNumber` moves; the workspace sets `immediatelyRender: false`, so the cached editor is
`null`, and no transaction fires until the user types. A selector branching on that argument
therefore returns its editor-is-null result forever on an untouched document.

Read the editor from the component's own props instead and let the snapshot serve only as the
invalidation signal:

```ts
const state = useEditorState({
  editor,
  selector: () => (editor === null ? undefined : { bold: editor.isActive('bold') }),
});
```

A re-render replaces the selector closure, so the value is recomputed as soon as `editor` stops
being null; a transaction bumps `transactionNumber` and recomputes it again. Equality is
`deepEqual` by default, so returning a fresh object of flags each time is correct and cheap.

### The sheet

`.cryple-page-stack` in [`globals.css`](../app/globals.css) is A4 written in millimetres —
`--page-width: 210mm`, `--page-height: 297mm`, `--page-margin: 25.4mm` — because CSS defines
`1in = 96px = 25.4mm` exactly, so physical units are deterministic here and a pixel width is only a
paper size in disguise. The previous `max-w-[816px]` was US Letter. The margin collapses below `30rem` so the text column survives on a phone.

The document renders as **discrete sheets, not one continuous page**. That is two layers: an
`aria-hidden` absolute layer painting one `.cryple-sheet` per page, and the text flowing above it
in a single `.cryple-page` whose `min-height` is `--page-count` pages plus the gaps between them.
The text never moves between containers — splitting it into per-page containers is what would
force a document mutation — so the flow stays one uninterrupted ProseMirror document and only the
background knows about pages.

`.cryple-page` → `.cryple-page-body` → `.ProseMirror` is a three-link flex chain so the editable
element fills the sheet. Without it the lower two-thirds of the page belongs to the sheet rather
than to ProseMirror, and clicking there does nothing. With it, ProseMirror's own hit-testing places
the caret — do not add a click handler calling `focus('end')`, which puts the caret in the wrong
place whenever the user clicked beside a paragraph rather than below the last one.

The header is sticky and its height changes when the toolbar wraps, so a `ResizeObserver` writes
the measured height to `--doc-chrome-h` and headings carry a matching `scroll-margin-top`. That is
what keeps an outline click from landing its target underneath the chrome, and it is one
declaration rather than offset arithmetic at each call site.

Printing is the export path: `@media print` hides everything marked `cryple-no-print` (header,
toolbar, outline), drops the sheet's border, shadow and radius, and sets `@page { size: A4;
margin: 0 }` so the printed margins are the sheet's own padding — the same declaration as on
screen. Browser-added headers and footers are the user's print-dialog setting and cannot be
suppressed from CSS.

The page count in the header comes from the pagination plugin, so it is the real number of sheets
rather than a words-per-page guess that would disagree with what prints.

### Pagination

The plugin measures each top-level block, hands the heights to
[`paginate`](../lib/documents/pagination.ts), and turns the answer into `Decoration.node` entries
that insert a fixed-height spacer before the first block of each page — filling the rest of the
previous sheet and the gutter between sheets. **No document transaction is ever dispatched**; the only transaction
carries `setMeta` and no steps, so nothing reaches the CRDT. Read the reasoning in
[`lib/documents`](../lib/documents/README.md#pagination-is-measured-never-written) before changing
any of it.

Four details are load-bearing:

- **Widget decorations, not node decorations.** A node decoration is dropped the moment its node
  stops being exactly one node — pressing Enter inside the first block of a page splits it, the
  decoration disappears, and the page collapses upward so the text renders in the gutter between
  sheets. A widget is a single position, which maps through a split intact. It also keeps the
  measurement honest: block heights are read straight off the element, with no injected padding to
  subtract back out.
- **`.cryple-prose` spacing is `margin-top` only**, and `:first-child` gets none. Blocks with a
  `margin-bottom` would collapse against the next block's `margin-top` and the measured heights
  would no longer sum to the rendered flow. The first-child rule matters because `.ProseMirror` is
  a flex item and therefore a BFC root: the first block's margin does *not* escape it, so without
  the rule page one starts lower than every other page and the arithmetic drifts by that margin.
- **Measure in a microtask, never on a timer or `requestAnimationFrame`.** This is what decides
  whether the feature reads as *"the next line is on the next page"* or as *"the next line is in
  the gutter and something will move it shortly"*. Microtasks drain before the browser paints, so
  the corrected geometry is in place for the first frame that shows the edit and the intermediate
  state is never rendered. A timer defers past the paint — the text visibly lands in the gutter and
  jumps. rAF is worse still: it runs after layout, and it does not fire at all in a background tab,
  so a document opened in a tab that is not in front would never paginate until you looked at it.
  The layout reads force their own reflow, which is all the frame callback was ever wanted for.
- **The skip check compares block indices *and* the decorations' live anchor positions.** Skipping
  a rebuild is what keeps typing cheap, but it is only safe when the spacers already on screen are
  where this pass would have put them. Indices alone are not enough: a decoration is anchored to a
  document position, so after an edit that inserts or removes a block, "the break is at index 202"
  can be true of both the old and the new pagination while the spacer is anchored to what is now
  block 203. That renders as text spilling into the gutter and it never recovers, because every
  later pass agrees nothing changed. `sameAnchors` compares each live decoration's `from` against
  the position this pass computed for it, so the rebuild is skipped only when the spacers are
  genuinely already correct. See also
  [`samePagination`](../lib/documents/README.md#pagination-is-measured-never-written).

`MAX_PASSES` caps the settle loop so a pathological document cannot spin the microtask queue.

### Keeping it cheap on a long document

Measuring on every transaction is what buys the pre-paint correctness, so the measurement itself
has to be cheap. Three things make it so, and all three were found by profiling a 2 000-block,
116-page document rather than by guessing:

| | before | after |
| --- | --- | --- |
| Measurement pass | 70.7 ms | 0.9 ms |
| Whole keystroke | 44.3 ms | 21.7 ms |

- **Never call `view.nodeDOM` per block.** It resolves a position by walking siblings, so calling
  it once per top-level node is quadratic — 33.6 ms of the original 70.7 on its own. The elements
  are read from `view.dom.children` in one linear pass instead, skipping the spacer widgets and the
  gap cursor. `elementsByPosition` stays as a fallback for the case where that count disagrees with
  `doc.childCount`, which keeps correctness independent of assumptions about what ProseMirror
  renders.
- **Cache each block's measurement against its ProseMirror node.** Nodes are immutable and shared
  between states, so a node that is `===` the one measured last time cannot have changed height.
  A keystroke re-measures exactly the block it touched. The cache is a `WeakMap`, so it needs no
  eviction, and it is dropped whole when the editor's width changes or a web font finishes loading
  — the two things that change every height at once. Index 0 is never cached, because
  `:first-child` zeroes its margin and that would be wrong for the node anywhere else.
- **Do not dispatch when the pagination did not change.** Most keystrokes do not move a page break,
  and a dispatch is not free: it re-runs every `useEditorState` selector and re-renders the chrome.

The counts in the header are debounced for the same reason. `characterCount.words()` walks the
whole document — 9.3 ms on the 2 000-block document — and through `useEditorState` it ran on every
transaction, twice per keystroke once the pagination dispatch is counted. It is display-only, so it
now reads on a 400 ms trailing debounce like the outline does.

`paginate` uses a prefix-sum array so each page's extent is O(1) and the whole pass is O(n);
`pagination.test.ts` pins that with a 20 000-block case. It was never the bottleneck — 0.45 ms at
10 000 blocks even in the naive form — which is precisely why measuring first was worth it.

The residual page-to-sheet misalignment is bounded at ~1.5 px across 115 page breaks. Rounding the
spacer height is what makes it accumulate, because the sheets sit at exact multiples of the page
height while the spacers stack up rounding error; the height is therefore left fractional.

Print agrees with the screen **by construction** rather than by luck: the spacer is hidden and
`.cryple-page-gap + *` becomes `break-before: page`, so the browser breaks at exactly the blocks
the plugin chose. `@page { margin: 25.4mm }` with `.cryple-page` padding removed is what gives
pages two and onward their margins — box padding only applies at the start of the box, so the
sheet's own padding cannot serve a multi-page print.

`pageBreak` is an atom node of zero height: it marks the spot without consuming any of the page, so
the page simply ends where the user put it. It is the only pagination fact stored in the document,
and it is stored because it is the user's intent rather than a measurement. `Mod-Enter` inserts
one.

### The outline panel

`readOutline` walks only top-level blocks — returning `false` from the `descendants` callback stops
the descent — so a heading inside a table cell or a blockquote is not a section. Entries carry a
ProseMirror **position**, which is valid only for the state it was read from, so the outline is
re-read on every change rather than cached across transactions.

Nesting is a stack that pops while the top is at or below the incoming level, which handles a
document whose headings skip a level or never start at `h1`. Rows indent by **tree depth, not
heading level**, or a document written entirely in `h2` renders permanently indented.
`outlineTree` and `activeHeadingPos` are pure and live in
[`lib/documents/outline.ts`](../lib/documents/outline.ts) with tests; only the DOM scroll stays here.

The active row follows the **caret**, not the scroll position: the caret is what a writer tracks,
and it is already state. An `IntersectionObserver` would need tearing down and re-attaching on
every transaction, because ProseMirror replaces heading elements as the document changes.

The panel is `sticky` on the flex **item**, not on the `<nav>` inside it — a sticky element can
only travel within its parent's box, and with `items-start` that wrapper is only as tall as the
nav, so sticking the nav does nothing at all.

### Toolbar

Buttons reflect state (`aria-pressed`, `disabled` from `can()`), every command chains through
`.focus()`, and each control's `onMouseDown` is prevented so clicking it does not blur the editor.
The `Selection` extension is enabled for the same reason from the other side: the `<select>`s and
the link popover do take focus, and without it the user's selection visibly disappears while they
choose a font.

Link editing is an in-toolbar popover rather than `window.prompt`, which blocks the page, cannot be
styled, and had no way to edit an existing href. `extendMarkRange('link')` is what lets it work
from a bare caret inside a link. URL validation belongs to the Link extension's `isAllowedUri`
allowlist, not here.

The paragraph-style control calls `setHeading`, not `toggleHeading`: from a `<select>`, choosing
the level that is already active must be a no-op, and toggle turns it back into a paragraph while
the select still reads "Heading 2".

**The toolbar's values live in [`lib/document-styles`](../lib/document-styles/README.md)**, not here,
because they double as the allowlist. `extensions.ts` swaps TipTap's `Color`, `FontFamily`,
`FontSize`, `LineHeight` and `Highlight` attribute definitions for guarded ones built from the same
lists, so a pasted `style` or `data-color` can store only a value the toolbar could have set — or,
for colours, a plain colour. That module explains the injection it closes.

`FONT_FAMILIES` names `var(--font-sans)` and `var(--font-mono)` — the properties this app actually
defines in `globals.css`. They previously named `--font-geist-*`, which exist in the Next.js
starter template and not here, so two of the three font options silently did nothing. Any export
has to map these tokens to real family names explicitly.
