# `components/settings`

The Settings modal and its tabs. None of them is a place you keep things, so none earned a seat in
the sidebar; they open from the account menu ([`components/shell`](../shell/README.md#the-account-menu)).

| File | Role |
| --- | --- |
| `SettingsModal.tsx` | The modal, its vertical tab menu, and which tabs this device sees |
| `UsernameScreen.tsx` | The **Username** tab — one panel, `UsernameCard` |
| `UsernameCard.tsx` | The rename panel: the current name, the claim, and what a rename does |
| `PinScreen.tsx` | The **PIN** tab — this browser's PIN, turning Paranoid on, changing the account PIN |
| `DevicesScreen.tsx` | The **Devices** tab — the account's devices, names, chain verification, removing another device with the phrase |
| `ConnectExtension.tsx` | Inside the Devices tab: linking the browser extension — the code and its countdown, the fingerprint to compare, the device's name, and refusing on a mismatch ([`lib/pairing`](../../lib/pairing/README.md)) |
| `AccountScreen.tsx` | The **Account** tab — deleting the account with the phrase (and the account PIN on Paranoid) |

The **Sharing** tab is drawn by `SharingScreen`, which lives with the rest of sharing in
[`components/sharing`](../sharing/README.md).

## Settings is a modal with tabs

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

## The username panel is its own Settings tab

It spent a while sharing a **Security** screen with the PIN upgrade, two unrelated panels side by
side under a word vague enough to cover both. They split on 2026-09-12 into **Username** and
**PIN**, which is what a person is actually looking for when they open Settings — you go there to
change your name or to turn the PIN on, never to visit "security". `UsernameScreen` is a one-line
wrapper around `UsernameCard` and exists only to give the tab a panel of its own; `PinScreen` holds
what was the rest of `SecurityScreen`.

Neither uses `PanelGrid` any more. With the tab menu taking a column of the modal, one card in a
two-column grid would sit in half the remaining width with nothing beside it.

Everything the rename decides is in [`lib/app/username.ts`](../../lib/app/README.md#renaming-the-account);
the component sends the claim, calls `refreshAccount` so the header avatar and name follow the
rename, and clears the field only on success. The two sentences about what a rename does are
rendered unconditionally, not behind a disclosure — they are the panel's reason for existing as
much as the field is.

A rename is signed by this device's key, with no PIN, in either mode.
