# `components/session`

Who is signed in on this browser, and the screens before the app opens.

| File | Role |
| --- | --- |
| `CrypleProvider.tsx` | Session custody, phase machine, error translation, cross-tab handoff |
| `AppProviders.tsx` | Mounts `CrypleProvider` in the root layout so every route shares one session |
| `SessionGate.tsx` | The loading / onboarding / locked / ready switch, wrapped around each route |
| `Onboarding.tsx` | Sign up (phrase, Standard or Paranoid, PIN, recovery kit) and adding this browser with a phrase, including *I lost my devices* and the too-many-devices picker |
| `Unlock.tsx` | PIN unlock through the server's OPRF, with the attempts left, and *I forgot this browser's PIN* |

Every screen reads the session through `useCryple()` and `useAuthedContext()` from
`CrypleProvider.tsx`.

## Session custody

`CrypleProvider` owns the one `SessionKeystore`, the one `TokenStore` and the device record store
(IndexedDB). Its phase is `loading → onboarding | locked → ready`: `locked` when a device record
exists, `onboarding` when none does. The flows themselves are [`lib/account`](../../lib/account/README.md);
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

### The provider's `notice` ends with the session it explained

`notice` carries a sentence about *why* the app is where it is: this browser forgot the account
after too many wrong PINs, the device was removed, the session was renewed. The first two are set
on the way **out** to onboarding, where `Onboarding` shows them so the person knows why they are
typing their phrase again.

**Getting back in clears it.** Both ways into the vault — `becomeReady` after an unlock and
`enterVault` after signing up or adding this browser — call `setNotice(undefined)`. Before this,
the notice outlived the problem it described: after signing in again, *"This browser has forgotten
your account…"* sat on top of every screen, true of a session that no longer existed and with no way
to close it. The shell also shows it with a dismiss control, through `dismissNotice`, for the
notices that are raised while the vault is open.

## Onboarding

`createAccount` keeps the drafted genesis across a failed attempt, so a retry sends the same
batch; it discards the draft after an authentication refusal. The phrase stays in onboarding
state only until the recovery kit step is finished. `enrolBrowser` maps its outcomes to *no
account uses this phrase* (with *Create an account with this phrase*), the too-many-devices
picker, or a message.

Neither opens the vault on its own: the component calls `enterVault` immediately after adding a
browser, and after the recovery kit has been downloaded for a sign-up
([`lib/app` § Onboarding](../../lib/app/README.md#onboarding)).

The PDF is built by [`lib/recovery-kit`](../../lib/recovery-kit/README.md), loaded with a dynamic
`import()` on the first click so `pdf-lib` and the QR encoder stay out of every other page load.
The download uses the same object-URL-and-anchor approach as the drive, and the URL is revoked
straight after the click. The phrase can be revealed on the step but not copied: no copy button, no selection, and copy, cut
and drag are cancelled.

Sign-up is four screens: the phrase (word count), the mode, the PIN, the recovery kit. The mode
step presents Standard and Paranoid as a real choice: a two-option toggle (`role="radiogroup"`),
Standard by default, with only the selected mode's explanation shown under it, and the one-way,
no-reset warning as soon as Paranoid is picked. The PIN step repeats that warning for a Paranoid
account, above the fields, before the account is created. The PIN step opens with the first box focused, moves to the
confirmation after the sixth digit, and submits itself when the confirmation matches — on sign-up
and when adding a browser alike. Unlock submits on the sixth digit
([`lib/app`](../../lib/app/README.md#one-box-per-digit--pin-entryts)). The first and PIN steps' buttons are as wide
as the control they follow: the word-count pair, the six PIN boxes. The mode step's Continue sits
under the box as Back's twin, the same size, on its right. There is no
"disable Paranoid" control and there never will be.
