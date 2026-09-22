# `lib/document-styles`

The formatting values the document editor may hold, and the guards that stop anything else from
getting into a style attribute. Framework-free, so every guard is unit-tested in node;
[`components/documents/extensions.ts`](../../components/documents/extensions.ts) plugs them into
TipTap.

| Export | What it is |
| --- | --- |
| `FONT_FAMILIES`, `FONT_SIZES`, `LINE_HEIGHTS`, `TEXT_COLORS`, `HIGHLIGHT_COLORS` | What the toolbar offers, and what the guards accept |
| `safeColor`, `safeFontFamily`, `safeFontSize`, `safeLineHeight` | A value in, the value or `undefined` out |
| `styleAttribute(name, property, sanitize)` | A TipTap attribute spec that sanitises on parse **and** on render |
| `highlightColorAttribute()` | The same for the multicolor highlight, which also writes `data-color` |
| `styleDeclaration(style, property)` | One declaration out of a raw `style` string — a port of TipTap's own reader |

## What this defends against

TipTap's `Color`, `FontFamily`, `FontSize`, `LineHeight` and multicolor `Highlight` read a value
from pasted HTML and write it back into a `style` attribute by interpolation —
`background-color: ${color}`. Nothing checks the value.

**Reproduced on 2026-09-13 against `@tiptap/extension-highlight@3.31.3`** by calling its own
attribute spec with a pasted element. `data-color` is read raw, not split on `;`:

```
parseHTML  <mark data-color="red; background-image: url(https://tracker.example/opened)">
           → "red; background-image: url(https://tracker.example/opened)"
renderHTML → style="background-color: red; background-image: url(https://tracker.example/opened); color: inherit"
```

Stored in the document, that is a **beacon**: a request to someone else's server every time the
document is opened, on every device, carrying the time and the IP. CSS alone cannot read the
document's text, which is why this is low severity rather than a leak of content. The `style`
readers for the other four split on `;` first, so a paste cannot reach them the same way. Their
`renderHTML` interpolates whatever the document holds, though, so they are guarded too.

The Content Security Policy's `img-src` blocks the request as well
([`lib/security-headers`](../security-headers/README.md)). This is the layer that keeps the value out
of the document in the first place.

## The rules

- **Colours are a grammar, not a list.** Pasting from another editor should keep its colours, so
  `safeColor` accepts:
  - hex: 3, 4, 6 or 8 digits;
  - `rgb()` / `rgba()` / `hsl()` / `hsla()` whose arguments are only numbers, `%` or `deg`;
  - a bare alphabetic keyword.

  None of those can hold `;`, `(` beyond the one function, `:`, a quote, a backslash escape or a
  comment, so none can end the declaration or start `url(`.
- **Family, size and line height are lists.** Only what the toolbar can set survives. A family is
  compared with quotes and whitespace removed, so `Georgia,'Times New Roman',serif` maps to the
  toolbar's own spelling.
- **Every value is capped at 64 characters** before any other check.
- **Sanitised twice.** `parseHTML` stops a paste from storing the value. `renderHTML` refuses a bad
  value that is already in the document — from before this guard, or from a Yjs update that did not
  come through the editor.

**What the lists cost.** A paste from Google Docs or Word loses its font, its `11pt` sizes and its
`1.15` line spacing; the text arrives in the document's defaults. That is deliberate: the editor
offers eight sizes and four spacings, and a value it cannot show in its own toolbar is one the user
cannot see or change.

## What is not here, and why

- **`TextAlign`** already checks parsed values against its `alignments` option, and its commands
  refuse anything else.
- **`Link`** validates `href` with its own `isAllowedUri` allowlist.
- **Table column widths** are parsed as integers by TipTap.
