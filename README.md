# Cryple

Cryple is a vault for the things that matter after you are gone: passwords, account details,
private notes, instructions. You keep them encrypted. If you lose access, people you chose can
help you back in. If you die, the people you named inherit exactly what you left them.

Nobody at Cryple can read any of it. Not because of a policy, but because the servers never
receive anything readable. This repository is the web client — the part that runs in your browser
and does all the encryption and decryption. Everything else is storage.

## The problem

Password managers protect you while you are alive and paying attention. They are bad at two
things.

**Losing access.** Forget the master password on a properly encrypted vault and it is gone. The
provider cannot help without holding a key, and if they hold a key they can read your data.

**Dying.** Your family needs the accounts. The vault is doing its job by refusing them. The usual
answers are a printed sheet in a drawer, or trusting a company to hand things over correctly years
from now.

Cryple treats both as encryption problems rather than customer support problems. Recovery works
through people you nominate, and inheritance is arranged in advance while you can still make the
decisions.

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

It can see: that your account exists, how many items you have, roughly how large they are, when
they changed, that you have guardians, and that heirs are named.

It cannot see: your recovery phrase, your PIN, any item's contents, the private note you attached
to an heir, or which item goes to which person. Even the label you give an heir is encrypted, so
the server knows a relationship exists but not who anyone is to you.

This is why "we cannot read your data" is checkable rather than a promise. The code that would do
the reading is in this repository, and there is no key on the server side to do it with.

### Unlocking a device

You choose how signing in works, once, when you set up:

- **Standard** — your recovery phrase alone. No PIN anywhere. Nothing about your account is kept
  on the device, so you type your phrase again whenever the session ends: on every reload, and
  after fifteen idle minutes.
- **Paranoid** — a 6-digit PIN _and_ your phrase, both required, the PIN checked by the server.
  That same PIN also encrypts a copy of your phrase in this browser, so day to day you unlock with
  six digits instead of twenty-four words.

Paranoid mode exists for one scenario: someone steals your recovery phrase. Without your PIN it is
not enough. You can upgrade from Standard to Paranoid later, but **never the reverse** — a stolen
phrase must not be able to switch protection off. The app has no button to remove a PIN and never
will.

Turning a 6-digit PIN into a real encryption key takes deliberate effort — the app runs 600,000
rounds of a slow key-derivation function, which is why unlocking pauses for a moment. That pause
is the point: it makes guessing PINs expensive. It is paid once per session, not per action.

**Three wrong PINs erase the copy on that device.** Your vault is untouched — you get back in with
your recovery phrase, or through your guardians.

### Getting back in: guardians

Guardians are people you trust — family, close friends. They do not get access to your vault. They
hold a piece of the key that unlocks a recovery.

Nobody becomes a guardian by being named. You invite them by username, and the invitation waits in
their own guardian inbox until they accept it — an accepted guardian is one who agreed and knows
they agreed. Until then they count for nothing. Accepting cannot be undone from their side; only
you can remove a guardian.

The app takes a recovery key, encrypts your phrase with it, then splits that key into pieces using
a scheme where any _k_ of _n_ pieces rebuild it and anything fewer reveals **nothing at all**. Not
a partial answer, not a head start. Two pieces of a three-piece, three-required split are as
useless as zero.

You always hold one piece yourself, printed as a Recovery Kit. So three guardians means four
pieces. The common setup is two-of-three: you plus either of two guardians. That way one
unavailable guardian does not lock you out, and one guardian acting alone cannot do anything.

Each guardian's piece is encrypted specifically for them, so they cannot read each other's, and
the server cannot read any. During a recovery the server only passes messages along.

Two things to be clear about, because they are choices you make and not defaults you can ignore:

- **If you set the threshold to one guardian, that guardian can recover your vault alone.** The
  app warns you in those words when you configure it.
- If enough guardians collude, they rebuild your recovery phrase. In Paranoid mode they still hit
  the PIN and cannot get in. In Standard mode they are in. Choose accordingly.

### Passing it on: heirs

You name heirs by username and assign specific items to each. The key for each item is re-encrypted
so that only that person can ever open it. This happens on your device, while you are alive.

Heirs are not told. There is no invitation, no acceptance, no notification — naming someone would
otherwise publish a relationship you may have chosen to keep private. There is no heir-facing
screen in this app, deliberately.

When guardians agree that you have died or are incapacitated, they vote. Enough votes start a
countdown, which is visible to you so a mistake or a bad actor can be caught before anything is
released. The countdown and the release itself are handled on-chain, outside this API, so no
single company decides when your estate opens.

### Why post-quantum

Inheritance runs on a timescale of decades. Encrypted data captured today can be stored and
attacked later, and a sufficiently capable quantum computer would break the classical algorithms
in common use now.

So whenever Cryple encrypts something for another person — a guardian's piece, an heir's item key
— it uses two independent algorithms at once and combines them. One is the well-understood
classical choice; the other is a post-quantum standard. An attacker has to break **both**. If
either survives, your data stays sealed.

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

There are no comments in the code. Each module carries a `README.md` that explains it.

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
| [`lib/recovery`](./src/lib/recovery/README.md)     | Guardians, key splitting, recovery, PIN reset       |
| [`lib/succession`](./src/lib/succession/README.md) | Heirs, inherited keys, release votes                |
| [`lib/app`](./src/lib/app/README.md)               | Product logic behind the interface                  |
| [`components`](./src/components/README.md)         | The React screens                                   |

The test suite includes a fixture that reproduces every key derivation against values generated by
the backend. No backend test reads that file, so this suite is the only cross-client check that
these derivations are correct anywhere in the project. Keep it green.

One note for anyone auditing: Cryple has no secp256k1 key and no Ethereum account, and wallet
integration is not planned. The key derivation path reserves that branch and never uses it.
