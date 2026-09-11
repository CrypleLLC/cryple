# Cryple

[cryple.io](https://cryple.io)

Cryple is an encrypted personal drive: passwords, account details, private notes, long-form
documents. You keep them encrypted. If you lose access, people you chose can help you back in.

Nobody at Cryple can read any of it. Not because of a policy, but because the servers never
receive anything readable. This repository is the web client — the part that runs in your browser
and does all the encryption and decryption. Everything else is storage.

## The problem

Password managers protect you while you are alive and paying attention. They are bad at two
things.

**Losing access.** Forget the master password on a properly encrypted vault and it is gone. The
provider cannot help without holding a key, and if they hold a key they can read your data.

Cryple treats that as an encryption problem rather than a customer support problem. Nobody at
Cryple holds a key that could help — or that could be compelled. The trade is stated plainly
rather than hidden: **what you hold is what you have**, and the app's job is to make sure you
know that before you need it, not after.

## How it works

### Your recovery phrase is the account

When you start, the app generates a phrase of 12 or 24 ordinary English words. That phrase is not
a password you can reset. It _is_ the account. Every key Cryple uses is calculated from it, the
same way every time, on any device.

That has a good consequence and a hard one. The good one: type the phrase into a new browser and
your vault is there, with no account recovery process and nothing to ask permission for. The hard
one: the phrase cannot be reissued. Write it down and store it somewhere physical.

Your account name is a fingerprint of the phrase — a long string of hex characters. The math runs
one way only, so the server can recognise your account without ever learning the words behind it.

### What the server can and cannot see

Everything is encrypted in your browser before it is sent. The server receives sealed data and
stores it.

It can see: that your account exists, how many items you have, roughly how large they are, and
when they changed.

It cannot see: your recovery phrase, your PIN, or any item's contents. Even the labels you write
are encrypted.

This is why "we cannot read your data" is checkable rather than a promise. The code that would do
the reading is in this repository, and there is no key on the server side to do it with.

### Unlocking a device

Both modes use a 6-digit PIN, chosen once when you set up. It encrypts the copy of your phrase kept in
this browser and locks the app, so day to day you come back with six digits instead of twenty-four
words — on a reload, and after fifteen idle minutes. What you are choosing is what _else_ that PIN
does:

- **Standard** — the PIN never leaves the device. Signing in is your recovery phrase alone, so
  forgetting the PIN costs you nothing: log out, sign back in with your phrase, set a new one.
- **Paranoid** — the same PIN is _also_ checked by the server, so your phrase alone will not sign
  you in anywhere. **Forgetting it ends the account.** There is no reset, by anyone, ever.

Paranoid mode exists for one scenario: someone steals your recovery phrase. Without your PIN it is
not enough. You can upgrade from Standard to Paranoid later, but **never the reverse** — a stolen
phrase must not be able to switch protection off. The app has no button to remove a PIN and never
will.

Turning a 6-digit PIN into a real encryption key takes deliberate effort — the app runs 600,000
rounds of a slow key-derivation function, which is why unlocking pauses for a moment. That pause
is the point: it makes guessing PINs expensive. It is paid once per session, not per action.

**Three wrong PINs erase the copy on that device.** Your vault is untouched — you get back in with
your recovery phrase.

### There is no account recovery, and that is the design

An earlier version of Cryple let people you nominated hold pieces of a key that could rebuild your
phrase. It was removed on 2026-09-04, and the reasoning is worth stating rather than hiding:

- A guardian had to already have a Cryple account, so the feature only worked for people whose
  friends had already installed an unfamiliar app and written down a seed phrase of their own.
- "Your friends can restore your access" is the sentence that makes a privacy-minded reader ask
  who else can get in. For a product whose whole claim is that nobody can, the answer has to stay
  *nobody*.

So: **your phrase and your PIN are yours to keep.** In exchange, the answer to "who else could get
into my vault" is nothing, with no asterisk. The app's obligation is to be honest about that
up front — a printable kit at sign-up, plain words before you turn on Paranoid mode, and a later
nudge to check that the copy you saved is the copy that works.

### Why post-quantum

A vault runs on a timescale of decades. Encrypted data captured today can be stored and attacked
later, and a sufficiently capable quantum computer would break the classical algorithms in common
use now.

Your vault at rest does not depend on those algorithms: it is sealed with symmetric encryption,
which a quantum computer weakens but does not break. The hybrid construction matters for the other
case — **encrypting something for another person**, where the classical algorithms are what a
future attacker would target. So when Cryple wraps a key for someone else, it uses two independent
algorithms at once and combines them: one well-understood classical choice, one post-quantum
standard. An attacker has to break **both**.

That machinery is built, frozen and tested against fixed vectors. It has no caller at the moment —
private sharing, where you send one item to another person, is what will use it next.

## Running it locally

Requires Node and a running instance of the [Cryple API](../api-general).

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Point the client at your API in `.env.local`:

```bash
NEXT_PUBLIC_BASE_API_URL=http://localhost:8080
```

That is the only setting. It defaults to the value above.

```bash
npm test      # 469 tests
npm run lint
npm run build
```

## For developers

Next.js 15 (App Router), React 19, TypeScript in strict mode, Tailwind v4. Cryptography is
[@noble](https://github.com/paulmillr/noble-curves) plus the Web Crypto API.

Start with [AGENTS.md](./AGENTS.md). It carries the rules this codebase is built to and the
precedence order when documents disagree: the frozen specifications win on byte layouts and
constants, [front-end-guide.md](./front-end-guide.md) and
[front-end-endpoints.md](./front-end-endpoints.md) win on the wire contract.

| Module                                             | What it owns                                        |
| -------------------------------------------------- | --------------------------------------------------- |
| [`lib/keys`](./src/lib/keys/README.md)             | Recovery phrase to the full key tree                |
| [`lib/encoding`](./src/lib/encoding/README.md)     | hex, base64 and key-format conversions              |
| [`lib/pin`](./src/lib/pin/README.md)               | The second factor, the local vault, the wipe policy |
| [`lib/session`](./src/lib/session/README.md)       | In-memory key custody                               |
| [`lib/api`](./src/lib/api/README.md)               | Transport, error codes, pagination, tokens          |
| [`lib/signing`](./src/lib/signing/README.md)       | Request signatures and the action table             |
| [`lib/auth`](./src/lib/auth/README.md)             | Sign-up, sign-in, restoring on a new device         |
| [`lib/users`](./src/lib/users/README.md)           | Account, mode, public keys                          |
| [`lib/pqxdh`](./src/lib/pqxdh/README.md)           | Hybrid post-quantum encryption for another person   |
| [`lib/sealed`](./src/lib/sealed/README.md)         | The versioned encrypted-blob format                 |
| [`lib/secrets`](./src/lib/secrets/README.md)       | Vault items                                         |
| [`lib/app`](./src/lib/app/README.md)               | Product logic behind the interface                  |
| [`components`](./src/components/README.md)         | The React screens                                   |

The test suite includes a fixture that reproduces every key derivation against values generated by
the backend. No backend test reads that file, so this suite is the only cross-client check that
these derivations are correct anywhere in the project. Keep it green.

One note for anyone auditing: Cryple has no secp256k1 key and no Ethereum account, and wallet
integration is not planned. The key derivation path reserves that branch and never uses it.
