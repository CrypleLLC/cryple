# `lib/note-format` — the note document model

The block/span model behind the note editor: line types, inline styles, the font scale, and the
conversions between the stored string, the editing surface, and the tile.

The editor is **WYSIWYG** — bold text is bold on screen, a title is a real heading, a checklist
has real tick boxes. Nothing in the editor ever shows a `#` or a `**`. This module is what makes
that possible without inventing a new storage format.

It is **presentation, not protocol**, and it is framework-free and DOM-free: pure functions over
strings and plain objects, unit-tested in the repo's node environment. The DOM half lives in
[`components/note-surface.ts`](../../components/README.md#the-editing-surface).

## Storage stays a plain string

```
# a title line
- a topic line
- [ ] an open task
- [x] a done task
anything else is a plain line

**bold** and *italic* and ***both*** inline
```

This is what gets sealed. The user never sees it — it is the serialization, not the interface.
Keeping it a plain string rather than JSON buys four things:

- **Every note written before formatting existed is already valid**, a document of `text` lines.
  No migration, and `formatBlocks(parseBlocks(legacy))` returns it byte-for-byte. A test pins it.
- **A note stays readable by anything**, including a future client that has not implemented
  styling, which matters for a vault meant to outlive its owner.
- **The file name is still the first line**, so [`lib/app`](../app/README.md) needs no envelope to
  find it.
- **No key material or metadata is added to the payload** — the ciphertext is still just the text.

Two ordering rules the parser depends on: task markers are matched **before** the topic marker
they start with (`- [ ] ` begins with `- `), and a marker without its trailing space is not a
marker at all, so a line of `#` stays plain text.

## Inline styles pair or they are just text

`parseInline` matches only **complete pairs** on a single line:

```
/\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g
```

This is the rule that protects existing notes. `2 * 3 = 6` contains an asterisk and must survive
a load-edit-save round trip unchanged; a naive toggle-on-every-asterisk scanner would swallow it
and italicise the rest of the line. Unpaired asterisks stay ordinary characters, pinned by tests.

`formatInline` merges neighbouring spans of the same style first, so re-serializing never emits
`**a****b**`, and drops empty spans that browsers leave behind after an edit.

## Rendering, three ways

The same document renders differently in three places, and none of them shows markup:

| Function | Used by | `# Plans` / `- [x] flights` becomes |
| --- | --- | --- |
| `toHtml` | the editor surface | `<div data-line="title">Plans</div>` / `<div data-line="task" data-checked="true">flights</div>`; a sized run adds `<span style="font-size:18px">` outside `<strong>`/`<em>` |
| `toDisplayText` | the tile miniature | `Plans` / `☑ flights` |
| `toPlainText` | the file name, the character count | `Plans` / `flights` |

The surface HTML is deliberately flat — **one `<div>` per line, styled entirely by CSS from its
`data-line` attribute**, with `<strong>` / `<em>` inside. Bullets and tick boxes are `::before`
pseudo-elements, so they are **not nodes**: the caret can never land inside one, selection never
includes one, and serialization never has to skip one. `data-checked` is the tick state, so
ticking a box is a one-attribute change that leaves the text and the caret untouched.

**`escapeHtml` runs on every span.** The note is decrypted from the user's own vault, but it is
still untrusted input to an `innerHTML` assignment — a note whose text is `<img src=x onerror=…>`
must render as characters, not as an element. A test asserts it.

## The block cycle

`cycleBlockType` is the toolbar's whole semantics:

| Command | Behaviour |
| --- | --- |
| `title`, `topic` | Toggle — applying it to a line of that type clears it, applying it to any other type **replaces** the marker |
| `task` | Cycles **open → done → off**, so one button creates a checklist item and ticks it |

Types replace rather than stack, and the line's text survives every transition (pinned by a test
that walks a line through all of them).

## Font size is inline formatting, not a setting

Size behaves exactly like bold: it applies to **the selected text**, or to the current line when
nothing is selected. It is therefore part of the document — a span carries an optional `size`, and
a run of spans sharing one size serializes inside a wrapper:

```
one {{18}}two{{/}} three
- {{12}}a small topic line{{/}}
```

Wrappers are **outside** the style markers (`{{16}}**bold**{{/}}`) and outside the line marker, so
a line's type is never inside a size run. One wrapper is emitted per run, not per span, which is
why `mergeSpans` compares `size` as well as `bold`/`italic`.

The scale runs **12 to 24 in steps of 2**, and `NOTE_FONT_SIZES` is the single source of it — the
parser's size pattern is *built from that array* rather than written out, so widening the scale is
a one-line change and the two cannot drift apart.

`snapNoteFontSize` maps anything else onto the nearest stop, and **every size entering the model
goes through it**. That is a correctness requirement, not tidiness: the pattern matches only the
listed stops, so a stray `13` would serialize to `{{13}}…{{/}}` and fail to parse back — the
styling would silently vanish and the markers would surface as literal text in the note. Two tests
pin it: one walks off-scale values through `snap → format → parse`, the other round-trips every
entry in `NOTE_FONT_SIZES`, which is what would fail first if the scale and the pattern ever
diverged.

`changeNoteFontSize` steps along the array and stops at both ends; `canGrowNoteFont` /
`canShrinkNoteFont` tell the toolbar when to disable a button rather than letting it appear to do
nothing.

Sizes never reach the file name, the thumbnail or the character count — they are markers like any
other. An unpaired `{{16}}`, an unknown size, or ordinary braces in prose all stay literal text,
the same pairing rule that protects `2 * 3 = 6`.

## The character limit counts what the user can see

`noteCharacterCount` in [`lib/notes`](../notes/README.md) counts `toPlainText(stored)`, not the
stored string. Once the markers became invisible, counting them would have meant the counter
dropping by 6 when a user pressed Checklist and typed nothing — a limit the user cannot see the
cause of.

The trade is that a pathological document (thousands of one-character checklist lines) can carry
enough marker overhead to approach the server's 32,768-character ciphertext ceiling while
appearing to be under 5,000. That is why `assertWithinCiphertextCeiling` still guards both
`POST` and `PUT` — the ceiling check is the backstop that makes the friendlier count safe.

## What this does not do

- **No nesting, no ordered lists, no links, no code spans, no colours.** Adding one is a line
  type, a `cycleBlockType` branch, a CSS rule and a glyph — the model has room, but nothing here
  should grow without a reason from the product.
- **No multi-line inline styling.** A pair of markers must open and close on one line, because a
  line is the unit that serializes.
