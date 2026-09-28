# `components/item-list`

The table the Vault and the Passwords tab list their items in. Import from `@/components/item-list`.

`ItemList` is the whole panel: a `Card`, the screen's error `Notice`, a `Spinner` while `rows` is
`undefined`, an `Empty` state when there are none, and otherwise the table. **It has no heading of
its own**: the shell's top bar already names the section and says what it holds, and a second title
and description over the table only repeated it.
`ItemTable` is the table on its own, for a screen that wants to lay the rest out itself.

A screen describes its columns and nothing else:

```tsx
<ItemList
  rows={rows}
  rowKey={(row) => row.id}
  columns={[
    { header: 'Name', kind: 'name', width: 'max-w-[16rem]', render: (row) => row.name },
    { header: 'Value', kind: 'secret', render: (row) => (revealed ? row.value : MASKED_VALUE) },
    { header: 'Updated', kind: 'meta', render: (row) => formatDate(row.updatedAt) },
  ]}
  actions={(row) => <CopyButton value={row.value} />}
/>
```

- **`kind` sets the type, not the content.** `name` is the row's title (semibold ink), `text` is
  plain body copy, `secret` is monospace, `meta` is the caption scale and never wraps. A masked value
  is still a `secret` column: `render` decides whether to show the value or the mask, so the column
  keeps the same width either way and the mask does not reveal the value's length.
- **A `secret` column wraps instead of truncating.** A long value — a seed phrase, a key, a
  password manager's 64-character password — breaks over as many lines as it needs
  (`whitespace-pre-wrap break-all`, keeping the line breaks the user typed), inside the column's
  `width`. Past `max-h-40` (160px) the cell scrolls on its own, so one 700 KiB secret cannot turn
  the table into a wall. Both the Vault's *Value* and Passwords' *Password* use `max-w-[20rem]`.
  The mask is short, so a masked row stays one line; the rows grow only when values are shown.
- **`name` and `text` columns wrap too**, so a long secret name, site or username is read in
  full over several lines inside its `width` rather than cut at an ellipsis. They use
  `overflow-wrap: anywhere`, which breaks between words first and inside a word only when a word
  is wider than the column — a long name stays readable, and an address with no spaces still fits.
  They are not height-capped: a name is not a payload.
- **A name column and a value column are never narrower than 32 characters** (`min-w-[32ch]` in
  their `width`): the Vault's *Name* and *Value*, Passwords' *Site* and *Password*. Wrapping made
  it possible for the table to squeeze them down to a few characters a line, which turns a seed
  phrase into a column of fragments. `ch` is the width of one character in the column's own font,
  so the monospace value's 32 characters are a little wider than the name's. Their caps are 16rem
  and 20rem, both above 32 characters of 13px type. On a phone this is wider than the screen, and
  the table scrolls sideways inside its wrapper, as it already does.
- **Cells are top-aligned**, so a row's name, date and buttons sit level with the first line of a
  value that wraps, rather than floating in the middle of it.
- **`width` is applied to a block inside the cell, not to the `<td>`.** Browsers largely ignore
  `max-width` on a table cell, so a width set there did not cap the column; on the inner block it
  does, and truncation and wrapping both happen inside it.
- **`width` is a Tailwind class passed as a literal** (`'max-w-[14rem]'`), so Tailwind finds it in
  the caller's source. Building it from a number would produce a class Tailwind never generates.
- **The last column holds the row's controls**, right-aligned, rendered from `actions(row)`. A row's
  controls are a component's business, not the table's. Its heading is `actionsHeader`, and since
  the buttons are icons only, a screen names them there in the order they are drawn, with
  `actionsHeader()` from `lib/app/listing.ts`: *Copy | Share | Delete*. A button the screen will
  not draw is passed as `false` and left out — the Vault's *Move* when there is only one tab, and
  *Delete* on a browser that is not a full device. Without the prop the heading reads *Actions*.
- **The controls column never wraps.** Its heading and its buttons are `whitespace-nowrap`, the
  buttons `shrink-0`, and the column is `w-px`, so it takes exactly the width of its widest row and
  the other columns give up the rest. On a phone that is narrower than the whole row, the table
  scrolls sideways inside its wrapper instead of stacking the buttons or breaking the heading.
- **`onRowDragStart` adds a grip handle at the start of each row, and only the handle drags.**
  Making the whole `<tr>` draggable, as it once was, made its text impossible to select: a press
  and move inside a draggable element starts a drag, with the mouse and with a long press on
  touch. Now every row's text selects like any other text (`select-text` on the body), and the
  handle (`select-none`, `touch-none`) is the one place a drag begins. It sets the whole row as the
  drag image, so what the user sees moving is still the secret, not a dotted glyph.
  `dragHandleLabel` is its tooltip and accessible name. The Vault passes the handler only when
  there are at least two tabs — the same condition that shows *Move* — because with one tab there
  is nowhere to drop; Passwords has no tabs and never passes it.

**A date column is `DateTimeCell`**, the date on one line and the time under it in a lighter ink
(`dateAndTimeLabels` in `lib/app/listing.ts`, both in the browser's locale). One
`toLocaleString()` line was the widest thing in the row and never wrapped, so it pushed the
actions off a narrow screen. Both screens show the date and the time and nothing else.

**The first column has no left padding**, so the names line up with the screen's own left edge —
the tabs, the page title, everything else on the page — rather than sitting indented inside a card
that is no longer drawn ([A block is not drawn at all](../README.md#the-token-layer)). Only the
controls column keeps an inset on its right. The rows are separated by a hairline, which is how a
table stays scannable.
