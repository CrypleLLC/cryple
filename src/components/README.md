# `components`

Milestone 5 — Tasks 24 and 25. The React surface. Every decision that can be tested without a DOM
lives in [`src/lib/app`](../lib/app/README.md); these files render it and nothing more, because
the repo's Vitest setup is node-environment and matches `src/**/*.test.ts` only.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation, cross-tab handoff |
| `AppProviders.tsx` | Mounts `CrypleProvider` in the root layout so every route shares one session |
| `SessionGate.tsx` | The loading / onboarding / locked / ready switch, wrapped around each route |
| `Onboarding.tsx` | Task 24 — phrase, PIN, mode, enrolment |
| `Unlock.tsx` | PIN unlock and the 3-attempt device wipe |
| `AppShell.tsx` | Task 25 — the sidebar shell and navigation registry |
| `VaultScreen.tsx` | Vault index, add/delete secrets (Task 34) |
| `VaultReveal.tsx` | The vault's global show/hide-values state and its top-bar button |
| `NotesScreen.tsx` | The notes file grid, selection and batch delete |
| `NoteEditor.tsx` | One note open — autosave, delete, WYSIWYG formatting |
| `NoteEditorToolbar.tsx` | The editor's formatting controls |
| `note-surface.ts` | DOM ↔ note document, for the `contentEditable` surface |
| `DocumentsScreen.tsx` | The documents grid — opens each document in its own tab |
| `documents/DocumentWorkspace.tsx` | The `/docs/[id]` page: title, toolbar, page canvas, save status |
| `documents/DocumentToolbar.tsx` | The TipTap formatting toolbar |
| `documents/useDocumentSync.ts` | Binds `DocumentSync` to a component's lifetime |
| `documents/extensions.ts` | The TipTap extension set, bound to the document's `Y.Doc` |
| `GuardiansScreen.tsx` | Guardians, recovery setup, Recovery Kit |
| `GuardianInbox.tsx` | The merged guardian queue, 1-minute poll |
| `SuccessionScreen.tsx` | Release status, vote audit, heirs, protection |
| `InheritanceScreen.tsx` | The heir's side — verify against the chain, then open |
| `HeirTabs.tsx` | One tab per heir — what they inherit, and the actions on it |
| `SetInheritanceModal.tsx` | Choosing which vault items an heir inherits |
| `RecoveryKitCard.tsx` | The printable share-0 surface |
| `ui.tsx` | Card / Button / Field / TextArea / Badge / Notice / Modal primitives |
| `icons.tsx` | The stroke-icon set shared by navigation and primitives |
| `StagingBanner.tsx` | The walking red warning banner, dev-only — see [`app`](../app/README.md#the-staging-banner) |

## Layout and design system

The shell is a Drive-style dashboard: a fixed left sidebar with the logo, the navigation and the
account summary, a sticky top bar carrying the current section's title and the session-exit
buttons, and a constrained content column. Below the `md` breakpoint the sidebar folds into a
sticky top header with a horizontally scrolling nav row.

Navigation is one registry, `NAV_ITEMS` in `AppShell.tsx`. Each entry is
`{ id, label, description, icon, screen, actions? }`; adding a section (a document editor is still
planned) means adding one entry and its screen component — the sidebar, the mobile nav and the
top-bar heading all render from the same array. Notes was added exactly that way, as one entry
between Vault and Guardians. `actions` is the optional slot for a
component rendered in the top bar beside Lock / Log out, for controls that belong to the whole
screen rather than to one panel; the Vault's global reveal toggle is the first of them. State
shared between such a control and its screen lives in a provider wrapping the shell, as
`VaultReveal.tsx` does, since the header sits outside the screen's tree.

Content panels follow the GCP/AWS console idiom rather than floating cards: the page background
matches the panel background, so a panel is delineated only by its 1px border and its header
strip, with no shadow and small corner radii. `Card` takes a `flush` prop for table and list
content, which then runs edge-to-edge inside the panel (rows carry their own horizontal padding),
the way console tables do. The content column is full-width with a small gutter, not a centered
column. Panels that do not need the full width sit inside a `PanelGrid` — a two-column grid from
`md` up, a single stacked column on mobile. Grid items stretch, so neighbours in the same row
share a height and their borders line up regardless of how much content each holds. A lone panel
occupies half the content width and two sit side by side. Guardians puts all four of its panels
in one grid; Succession keeps "Release status"
outside it at full width and grids the rest; Vault keeps its table full width and grids the form.
Wide tables and dashboards stay outside a grid.

The brand color is `#667eea`, defined once as the `brand` scale in
[`globals.css`](../app/globals.css) via Tailwind's `@theme`. It is used sparingly — primary
buttons, the active nav item, focus rings, the avatar and the Paranoid-mode badge — over a
neutral slate surface, in the manner of Drive/Proton. Destructive buttons are outlined rather
than solid so rows of actions stay calm. Every interactive primitive carries a
`focus-visible` brand ring. All colors have dark-mode variants keyed off
`prefers-color-scheme`.

## The heir's screen

`InheritanceScreen.tsx` is a section of the app, not a parallel client — an heir is an ordinary
signed-in user with their own seed, their own account and probably their own vault.

**Its empty state is the normal one, and it is deliberately uninformative.** An account that named
you but whose owner is alive is omitted from `GET /succession/inheritances` entirely, so a named
heir and a stranger see the same empty screen. That is the point: an heir who knows they are named
can watch the owner's public on-chain check-in cadence. Never add a count, a "pending" row, or a
"you may be an heir" hint — the API cannot answer it, and the reason it cannot is a decision, not a
gap.

**The root comes from `fetchRootAt`, not from a response.** Everything else on the page is served
by Cryple; the value it is checked against is read from `ProofRegistry` using the
`smart_account_address` the listing carries. A root handed over by the API would prove nothing,
because the API is what the verification exists to be independent of.

Verification and decryption are one button, in that order, and
[`openInherited`](../lib/app/README.md#claiming-an-inheritance) refuses to decrypt an item that
failed — so a wrong result shows the failure and no content, rather than content with a warning
over it.

## Protection lives on Succession, not Vault

`VaultProtectionCard.tsx` moved off the Vault screen. Protection covers **what heirs inherit** and
the proof exists **for them**, so beside the heir tabs it reads as part of succession; on the Vault
screen it read as a property of storage, which is what made "protect my vault" sound like it should
cover the whole vault.

Anchoring is two writes and the order is not negotiable: `saveAnchorLeaves` first, the userOp
second. Leaves with no root on-chain are harmless and correctable; a root with no leaves is
permanent, because the epoch freezes. The `storing` busy label exists so that step is visible
rather than looking like a stalled signature.

**A secret has no update path.** The API is create-or-return by id, so editing one is
delete-then-recreate under a **new id** — which silently drops its assignment, and the heir tab's
count is what surfaces it. Notes and documents keep their id and their DEK across edits, so their
shares survive. This is a real gap in the product, not in this screen; it is listed under open
follow-ups.

## One tab per heir

`HeirTabs.tsx` replaced the flat "Who inherits" list. Each heir is a tab labelled with their
username and a count; the panel below holds what they inherit, **Set inheritance**, per-item
removal, and heir removal.

**Release status, the vote audit and the heartbeat card stay outside the tabs.** They describe the
account's switch, not one heir, and nesting them under a name would suggest a countdown could run
per heir. It cannot — there is one switch.

**The vault is opened once for the whole screen, not per tab.** Every title in the panel comes from
decrypted content — a share carries `item_id` and `item_type` and nothing else, because the server
never learns a title — so two heirs looking at the same vault must not decrypt it twice.

**A share whose item is missing is shown, not filtered.** Deleting an item deletes its shares in the
same transaction, so the row should be unreachable; that is exactly why hiding it would be the wrong
response. An owner seeing a row they cannot explain beats an owner told an heir inherits less than
the server says.

**Removing an heir is one call.** `DELETE /succession/beneficiaries/{id}` cascades to their wrapped
keys; deleting the shares first would be a series of signed calls that can half-fail, for a result
the single call already guarantees. The confirmation names what goes, because the cascade is
invisible and those keys are the one thing only the owner's client can regenerate.

The open tab follows the list rather than owning it (`nextActiveTab`): it survives a re-read so a
refresh cannot move the owner mid-task, and falls back to the first tab rather than to none when the
heir being viewed is removed — a blank panel reads as though everything is gone.

## Setting what an heir inherits

`SetInheritanceModal.tsx` opens from an heir's row on the Succession screen. It is the only place
an item is assigned, and its two rules are both about not destroying anything by accident.

**Every box opens unchecked, every time.** This is where an owner *chooses what to share*, not
where they edit a saved selection. So an unticked box means "not chosen in this pass", never
"revoke" — the footer says so in `UNCHECKED_IS_NOT_REMOVAL`, because a list of empty checkboxes
otherwise reads as "this heir inherits nothing".

**Items the heir already holds are listed, marked "already shared", and disabled.** Listing them
is what stops the blank checkboxes from being alarming. Disabling them is a step past what
[`itemsToAssign`](../lib/app/README.md#nothing-here-unassigns) requires — it filters them anyway —
but a tick that provably does nothing is a worse affordance than no tick at all, and "Select all"
skips them for the same reason.

An item this device cannot open is listed, disabled, and says so. Assigning it would re-wrap a DEK
that was never shown to open.

**A partial save leaves the failures ticked.** After re-reading, the items that landed come back
marked already shared and the ones that did not are still chosen, so retrying is one click rather
than hunting through the list again.

The heir's `user_address` comes from their beneficiary record (`recipientFor`), which is the only
place it exists — `GET /users/lookup` maps address to username and never the reverse. A closed
account has none, so the modal refuses to open for one even though the screen already hides the
button.

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

## Session custody

`CrypleProvider` owns the one `SessionKeystore` and the one `TokenStore` for the app. Its phase is
`loading → onboarding | locked → ready`, decided by whether a local seed vault exists.

**Unlock once, sign from memory.** The 600k-iteration PIN stretch is paid at unlock; the derived
signing key and `Server_Auth_Token` stay in the keystore for the session. Nothing prompts for the
PIN per action.

The provider subscribes to `session.onLock()`, so the keystore's own idle timeout drives the UI
back to `locked` rather than the two drifting apart.

`reportError` is the single funnel for failures: it renders `userMessageFor(error)` — copy built
client-side from the `code`, since the API sends no message — and drops the token on
`401 UNAUTHORIZED`, which is the only 401 meaning "sign in again". `401 INVALID_CREDENTIALS`
renders as one generic message, because a bad signature and a wrong PIN are indistinguishable by
design.

**Logout is deleting our own copy of the token.** There is no revocation endpoint, no session
list, and no "sign out all devices" — none of that is rendered anywhere.

## Onboarding

`enrol` writes the local seed vault **after** `POST /sign-up` succeeds, so a rejected enrolment
does not leave a vault for an account that was never created. On any failure the keystore is
locked, zeroing what was derived.

The mode step states the one-way door before either button. There is no "disable PIN" control and
there never will be.

## Recovery setup asks for the PIN again

`SessionKeystore` holds the derived key tree, not the mnemonic — deliberately. Splitting a REK
needs the seed **phrase**, so the Guardians screen re-opens the local vault with
`unlockSeedVault(pin)` for that one operation. That is a real re-prompt, and the field says why.

It no longer asks for guardian addresses. PQXDH's `info` string binds the recipient's
`user_address`, and `GET /recovery/guardians` now returns it on `active` rows, so `recipientFor`
reads it off the row. The screen used to make the owner type each 64-hex address and check it with
`GET /users/lookup`; wrapping a share to a mistyped address produces a blob the guardian can never
open and nothing server-side would catch it, so removing the field removed the failure.

Quorum is shown as `min(configured, active)` alongside the guardian count, with an explicit
warning when the configured threshold exceeds the number of guardians who can actually answer.
The k=1 sole-guardian warning is rendered verbatim from the spec.

## Getting back in without the phrase

`SeedRecovery.tsx` sits behind an **I lost my recovery phrase** link on the sign-in tab, not
behind a third tab — it is a rare path, and a tab implies parity with signing up and signing in.
On success it hands the phrase to `Onboarding`, which dispatches the ordinary `import` origin, so
the PIN step and `enrol` are shared code rather than a parallel flow.

The ephemeral hybrid key pair lives in a `useRef` and is disposed on unmount, on restart and on
completion. It is never persisted, because it cannot usefully be: a reload loses the private
halves and every share already submitted becomes unopenable. That is why the screen keeps saying
to leave the tab open, and why the request is issued exactly once — it is unsigned and not
retry-safe.

Polling runs in an effect with an `AbortController`, so closing the screen stops it. A
`SessionExpiredError` is rendered as its own copy rather than through `reportError`, because the
remedy — start again, guardians must re-send — is specific and an API code cannot express it.

The reducer and every derived number live in [`src/lib/app/seed-recovery.ts`](../lib/app/seed-recovery.ts)
so they are testable without a DOM, which is where the "guardians alone must meet the threshold"
rule is enforced and explained.

## Product boundaries this shell respects

Taken from [AGENTS.md § Product boundaries](../../AGENTS.md); each of these is an absence, so it is
recorded here rather than being visible in the code:

- **No heir-facing screens.** Nothing lets a named heir discover, accept, decline or claim an
  inheritance. Before release that is permanent by design; after release the routes do not exist.
- **No session list or "sign out all devices".**
- **No key-rotation flow.** `keys_rotated: true` renders "this heir closed their account — remove
  them and choose another", never a re-wrap prompt.
- **No UI waiting on `released`, `cancelled` or `completed` in the off-chain status.** The
  succession dashboard renders only `monitoring` and `counting_down` there. Release is reported on
  `chain.status`, which the dashboard reads but does not yet act on — the heir path is Task 54.
- **Last check-in has three renderings, not one.** A date when the chain has one, "Not configured
  on-chain" when the smart account has never been configured, and "Unavailable" when the API could
  not read its mirror. The third is an outage on our side and must never read as the second.
- **No check-in or dead-man's-switch configuration.** Both are on-chain owner actions; the screen
  says so instead of offering controls that would silently do nothing.

## Nothing here is blocked any more

Two screens used to surface an unresolved backend spec gap rather than hide or fake it, and both
are now closed:

- **Vault items** (`KekNotSpecifiedError`) — Decision A landed 2026-08-08, wired in 2026-08-10.
- **Naming an heir** (`LabelKeyNotSpecifiedError`) — `Cryple-Key-v1|heir-label` landed 2026-08-20,
  wired the same day. See [`src/lib/app`](../lib/app/README.md#the-heir-label).

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

## Notes is the one screen with no panel

`NotesScreen` is a section like Vault or Guardians — same `NAV_ITEMS` entry, same top bar — but
it deliberately **does not use `Card`**. The files render straight into the content column with
no panel border around them, because the console panel idiom exists to group controls, and a
file browser's content *is* the grouping. A border there would read as a second, redundant frame
around a grid that already has visible objects in it.

The tiles themselves are not borderless. Each is a page-shaped thumbnail (`aspect-[3/4]`) with a
shadow and a hairline ring, carrying the note's real first ~420 characters at 9px under a
bottom fade, with the title and date beneath it as a filename. That reads as a stack of paper
rather than as a list of rows — the ring belongs to the object, not to the section. A note that
will not decrypt shows the notes glyph instead of content, keeping its tile.

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

The writing surface is **WYSIWYG**: a `contentEditable` div with no border or ring, on the page
background. Bold text is bold, a title is a real heading, a checklist has real tick boxes. The
user never sees a `#` or a `**` — that spelling is only how the note serializes.

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
that record's DEK — the component never constructs a `wrapped_dek` itself, which is what keeps
heirs' wrapped keys valid (see
[`lib/notes`](../lib/notes/README.md#the-dek-must-survive-the-edit)).

Delete is the only notes action needing the seed key, and it is **two-step**: the button reveals
a confirmation that says the deletion also removes the note from anyone set to inherit it,
because the server destroys those `inheritance_shares` rows in the same transaction and the
response does not report how many went with it. Vault's row Delete is one-step by comparison;
this one guards a longer piece of writing.

A note that will not decrypt opens read-only, with **saving disabled**, so a re-seal cannot
overwrite content this device could not read in the first place.
