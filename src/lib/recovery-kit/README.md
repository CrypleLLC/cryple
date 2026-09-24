# `recovery-kit`

The one-page PDF a new account saves at the end of sign-up. It carries the app name, the account's
username, the date, the recovery phrase as a numbered grid, and a QR code that holds the phrase so
the mobile app can sign in by scanning the page. Everything is built in the browser; nothing about
it touches the network.

| Export | What it does |
| --- | --- |
| `recoveryKitContent(input)` | Everything the page prints, as data — the single source the PDF draws from |
| `recoveryKitPhrase(mnemonic)` | The checksum-validated, single-spaced phrase; throws on an invalid one |
| `recoveryKitQrModules(payload)` | The QR matrix, quiet zone included |
| `qrModulePath(modules)` | The matrix as one SVG path, one rectangle per horizontal run |
| `recoveryKitGridCell(index, count)` | Where a word sits in the phrase grid |
| `recoveryKitFileName(username)` | `cryple-recovery-kit-<username>.pdf` |
| `buildRecoveryKitPdf(input)` | The PDF bytes |
| `RECOVERY_KIT_COPY` | Every string on the page |

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

Adding a scheme later (`cryple:…`) would break every kit already printed, so a reader should keep
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
variables. Fonts are the PDF standard fonts (Helvetica, Courier Bold for the words), which need no
embedding and no fetch. The username pattern and the BIP-39 English list are both ASCII, so the
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

So the generate branch runs phrase → PIN → enrolment → kit, and the vault opens only after the kit
has been downloaded at least once. The flow itself is in [`lib/app`](../app/README.md#onboarding).

## Dependencies

- **`pdf-lib`** writes the document. It runs in the browser and in Node — which is what lets the
  tests build a real PDF and load it back — and draws vector paths and standard fonts without
  fetching anything.
- **`uqr`** produces the QR matrix. It has no dependencies of its own and returns plain
  `boolean[][]`, which is all the PDF needs.

Both are large relative to how rarely they run, so `Onboarding.tsx` loads this module with a
dynamic `import()` when the download button is pressed, keeping them out of every other page load.

## What the download leaves behind

The bytes live in memory only until the browser hands them to its download manager; the object URL
is revoked straight after. What remains is the file itself, in plaintext, wherever the browser saves
downloads — which is the point, since it is meant to be kept — and the browser's download history,
which records the filename and so the username. Neither can be cleaned up from a web page. The step's
copy tells the user to move the file to offline storage or print it.
