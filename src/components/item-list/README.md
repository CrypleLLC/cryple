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
- **`onRowDragStart` makes rows draggable** and gives them the grab cursor. The Vault passes it so a
  secret can be dropped onto a tab; Passwords has no tabs and does not.

**A date column is `DateTimeCell`**, the date on one line and the time under it in a lighter ink
(`dateAndTimeLabels` in `lib/app/listing.ts`, both in the browser's locale). One
`toLocaleString()` line was the widest thing in the row and never wrapped, so it pushed the
actions off a narrow screen. Both screens show the date and the time and nothing else.

**The first column has no left padding**, so the names line up with the screen's own left edge —
the tabs, the page title, everything else on the page — rather than sitting indented inside a card
that is no longer drawn ([A block is not drawn at all](../README.md#the-token-layer)). Only the
controls column keeps an inset on its right. The rows are separated by a hairline, which is how a
table stays scannable.
