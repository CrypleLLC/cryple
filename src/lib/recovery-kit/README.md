# `recovery-kit`

The one-page PDF a new account saves at the end of sign-up. It carries the app name, the account's
username, the date, the recovery phrase as a numbered grid, and a QR code that holds the phrase so
the mobile app can sign in by scanning the page. Everything is built in the browser; nothing about
it touches the network.

| Export                              | What it does                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `recoveryKitContent(input)`         | Everything the page prints, as data — the single source the PDF draws from                                                      |
| `recoveryKitPhrase(mnemonic)`       | The checksum-validated, single-spaced phrase; throws on an invalid one                                                          |
| `recoveryKitQrModules(payload)`     | The QR matrix, quiet zone included                                                                                              |
| `qrModulePath(modules)`             | The matrix as one SVG path, one rectangle per horizontal run                                                                    |
| `recoveryKitGridCell(index, count)` | Where a word sits in the phrase grid                                                                                            |
| `recoveryKitWordOutlines(word)`     | A word as one glyph outline per letter, each with its advance; throws `RecoveryKitGlyphError` on a letter it has no outline for |
| `recoveryKitFileName(username)`     | `zekke-recovery-kit-<username>.pdf`                                                                                             |
| `buildRecoveryKitPdf(input)`        | The PDF bytes                                                                                                                   |
| `RECOVERY_KIT_COPY`                 | Every string on the page                                                                                                        |

## The phrase is drawn, not written

The words are **vector outlines**, not text. A PDF viewer cannot select or copy them, and there is
no text layer for the operating system's search index (Spotlight, Windows Search) to store or for
a document scanner to read. That last one is the point: information stealers sweep downloads for
runs of BIP-39 words, and a phrase written as text is exactly what they look for. Outlines raise the
bar to OCR. Everything else on the page — the headings, the username, the numbers — is ordinary
text, and a test asserts that the heading is extractable while no word of the phrase is.

Under the grid, `RECOVERY_KIT_COPY.phraseNotCopyable` says so in 8pt: the words cannot be copied
on purpose, because a clipboard is shared with other apps and often synced, so a reader who tries
learns why rather than suspecting a broken file.

The QR code still holds the phrase in the clear, because scanning it is how the mobile app signs
in. It is not in a text layer, indexers do not decode it, and stealers rarely do.

- **The outlines are data, generated once.** `glyphs.ts` holds `a`–`z` of JetBrains Mono Bold — the
  app's own monospace face — as SVG paths in font units (1000 per em, baseline at 0, every letter
  600 wide). The BIP-39 English list is `a`–`z` only, and a test checks every one of its 2048 words
  has an outline for every letter. `drawOutlinedWord` draws each letter with `drawSvgPath`,
  scaled to the word size.
- **Nothing is parsed at run time.** No font file ships and no font library runs in the browser;
  the page carries only the 26 paths (about 7 KB). `opentype.js` is a **dev dependency**, used by
  the generator only.
- **The licence travels with the outlines.** JetBrains Mono is under the SIL Open Font License 1.1;
  its text is `glyphs-OFL.txt`, next to the data derived from it.
- **Regenerating** (only to change the face):
  `node tools/recovery-kit-glyphs.mjs <path to JetBrainsMono-Bold.ttf>`, with the font from the
  [v2.304 release](https://github.com/JetBrains/JetBrainsMono/raw/v2.304/fonts/ttf/JetBrainsMono-Bold.ttf).
  The script refuses any file whose SHA-256 is not the one it pins, refuses a face that is not
  monospaced across `a`–`z`, and rewrites `glyphs.ts`. It passes `flipY: false` to
  `toPathData`: `opentype.js` 2 otherwise flips each glyph inside its own bounding box, which
  draws the letters upside down, or off the baseline if flipped back.

## The PIN is not in it, structurally

`RecoveryKitInput` is `{ username, mnemonic, createdAt }` and nothing else, so there is no argument
a PIN could be passed through and no field it could be printed into. A test pins the exact key set
of `RecoveryKitContent` and greps the copy for the word.

That matters most for Paranoid Mode. The kit's threat model is that someone finds it; the PIN is the
factor that keeps a found phrase from being an open account, so the two must never share a page. The
kit does not say which mode the account is in either — that would tell a finder whether the page
alone is enough.

## The QR payload is the contract with the mobile app

The code encodes **the phrase and nothing else**: lowercase BIP-39 words, NFKD-normalised, joined by
single ASCII spaces, UTF-8, no prefix, no URI scheme, no version byte. It is byte-for-byte what the
web sign-in accepts after trimming, so a scanner may hand the decoded text straight to the same
mnemonic check. A test feeds an untidy phrase in and asserts the payload comes out canonical.

Adding a scheme later (`zekke:…`) would break every kit already printed, so a reader should keep
accepting the bare phrase regardless.

- **Error correction `M`** (15%). A 24-word phrase fits in a version 8 symbol at that level, which
  prints at about a millimetre per module on the page — comfortably scannable. `Q` or `H` would buy
  resilience to damage at the cost of smaller modules, and a folded or faded kit is more likely to
  fail on module size than on missing area.
- **The quiet zone is part of the matrix** (`RECOVERY_KIT_QR_QUIET_ZONE_MODULES = 4`, the
  specification's minimum), so the drawn square already contains its white border and nothing on the
  page can be laid into it.
- **One path, one fill.** Drawing each module as its own rectangle leaves hairline seams between
  neighbours in most PDF viewers, and some scanners read a seam as a light module. `qrModulePath`
  merges each row's dark runs and the whole symbol is filled in a single operation.

## Layout

A4, 56pt margins, top to bottom: the name and "Recovery Kit", then the username and date beside the
QR code, then the phrase grid, then the warning. The grid fills **columns top to bottom** — 1–4 down
the first column for a 12-word phrase — which is how printed recovery sheets are conventionally read
back.

Colours are the design-system tokens from `globals.css` as literal RGB, since a PDF cannot read CSS
variables. Every other string is in the PDF standard fonts (Helvetica and Helvetica Bold), which
need no embedding and no fetch. The username pattern and the BIP-39 English list are both ASCII, so the
standard fonts' WinAnsi encoding covers every character the page can contain.

The username is shrunk to fit its column rather than wrapped, down to 8pt, so a 64-character name
stays on one line. `buildRecoveryKitPdf` throws `RecoveryKitOverflowError` if the content ever runs
past the bottom margin; a test builds the worst case — 24 words and a 64-character username — and
asserts it stays one page.

## Why the kit is offered after sign-up, not when the phrase is generated

The username is assigned by the server during `POST /sign-up`. By default it is the first 12
characters of `user_address`, but it grows by a character for every prefix already claimed, so the
client cannot know it in advance. A kit printed before enrolment would either omit the username or
guess it, and a wrong name on a document meant to be kept for years is worse than none.

So the generate branch runs phrase → mode → PIN → enrolment → kit, and the vault opens only after the kit
has been downloaded at least once. The flow itself is in [`lib/app`](../app/README.md#onboarding).

## Dependencies

- **`pdf-lib`** writes the document. It runs in the browser and in Node — which is what lets the
  tests build a real PDF and load it back — and draws vector paths and standard fonts without
  fetching anything.
- **`uqr`** produces the QR matrix. It has no dependencies of its own and returns plain
  `boolean[][]`, which is all the PDF needs.
- **`opentype.js`** (dev only) turns the font into `glyphs.ts`. See
  [The phrase is drawn, not written](#the-phrase-is-drawn-not-written).

**All three are pinned to an exact version** (`1.17.1`, `0.1.3`, `2.0.0`), not a range. They are
the code that handles the phrase, so a new release reaches them only by someone changing the pin
on purpose, and `npm ci` then checks every package against its hash in `package-lock.json`. None
of them makes a network request, and the page's Content Security Policy
([`lib/security-headers`](../security-headers/README.md)) allows connections to the API and the
object store only, so a compromised release could not send the phrase anywhere from this page
either. `pdf-lib` has had no release since 2021; that matters little here, because the kit only
**writes** PDFs, and an unmaintained PDF library is dangerous when it **reads** untrusted ones.

Both are large relative to how rarely they run, so `Onboarding.tsx` loads this module with a
dynamic `import()` when the download button is pressed, keeping them out of every other page load.

## What the download leaves behind

The bytes live in memory only until the browser hands them to its download manager; the object URL
is revoked straight after. What remains is the file itself, in plaintext, wherever the browser saves
downloads — which is the point, since it is meant to be kept — and the browser's download history,
which records the filename and so the username. Neither can be cleaned up from a web page. The step's
copy tells the user to move the file to offline storage or print it.
