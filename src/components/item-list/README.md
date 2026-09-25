# `components/item-list`

The table the Vault and the Passwords tab list their items in. Import from `@/components/item-list`.

`ItemList` is the whole panel: a `Card` with a title and subtitle, the screen's error `Notice`, a
`Spinner` while `rows` is `undefined`, an `Empty` state when there are none, and otherwise the table.
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
- **The last column is always *Actions*,** right-aligned, rendered from `actions(row)`. A row's
  controls are a component's business, not the table's.
- **`onRowDragStart` makes rows draggable** and gives them the grab cursor. The Vault passes it so a
  secret can be dropped onto a tab; Passwords has no tabs and does not.

The rows' first and last cells carry the horizontal padding, so the table runs edge to edge inside
its card, and the rows are separated by a hairline — which is how a table stays scannable.
