import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/test-vectors.json";
import type {
  Guardianship,
  PendingPinReset,
  PendingSession,
} from "@/lib/recovery";
import type { SecretMetaRecord, SecretRecord } from "@/lib/secrets";

import {
  actionableCount,
  buildInbox,
  buildVaultIndex,
  buildVaultRows,
  checkIntegrity,
  checkUpgrade,
  decodeRecoveryKitShare,
  decodeSecretPayload,
  encodeRecoveryKitShare,
  encodeSecretPayload,
  formatBytes,
  hasExpired,
  INBOX_ACTION_LABELS,
  INBOX_POLL_INTERVAL_MS,
  MalformedSecretPayloadError,
  MODE_COPY,
  RECOVERY_KIT_PREFIX,
  SECOND_FACTOR_COPY,
  RecoveryKitParseError,
  renderRecoveryKit,
  sessionExits,
  UNREADABLE_SECRET_NAME,
} from "./index";

const OWNER_ADDRESS = "a".repeat(64);

function session(overrides: Partial<PendingSession> = {}): PendingSession {
  return {
    session_id: "9c1e5f2a-4f89-11d3-9a0c-0305e82c3301",
    owner_username: "3f1c8a2b9d4e",
    ephemeral_x25519_public: "x",
    ephemeral_mlkem_public: "m",
    submitted: false,
    expires_at: "2026-07-26T12:30:00Z",
    created_at: "2026-07-26T12:00:00Z",
    ...overrides,
  };
}

function reset(overrides: Partial<PendingPinReset> = {}): PendingPinReset {
  return {
    request_id: "7b3d5e1c-4f89-11d3-9a0c-0305e82c3301",
    owner_username: "a92f4c1d8e0b",
    status: "pending_quorum",
    voted: false,
    created_at: "2026-07-26T11:00:00Z",
    ...overrides,
  };
}

function guardianship(overrides: Partial<Guardianship> = {}): Guardianship {
  return {
    id: "4a2c8f6e-4f89-11d3-9a0c-0305e82c3301",
    owner_username: "c71b3e9d5a02",
    status: "pending_invite",
    created_at: "2026-07-26T10:00:00Z",
    ...overrides,
  };
}

describe("the guardian inbox merges both queues", () => {
  it("polls about once a minute, not every few seconds", () => {
    expect(INBOX_POLL_INTERVAL_MS).toBe(60_000);
  });

  it("carries recovery sessions and PIN resets side by side", () => {
    const items = buildInbox([session()], [reset()]);

    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(["recovery-session", "pin-reset"]),
    );
  });

  it("floats what needs the guardian to act to the top", () => {
    const items = buildInbox(
      [session({ submitted: true })],
      [reset({ created_at: "2026-07-26T09:00:00Z" })],
    );

    expect(items[0].kind).toBe("pin-reset");
    expect(items[0].actionable).toBe(true);
    expect(items[1].actionable).toBe(false);
  });

  it("orders equally actionable items newest first", () => {
    const items = buildInbox(
      [session({ created_at: "2026-07-26T08:00:00Z" })],
      [reset({ created_at: "2026-07-26T13:00:00Z" })],
    );

    expect(items[0].kind).toBe("pin-reset");
  });

  it("counts only what the guardian can still act on", () => {
    const items = buildInbox(
      [session(), session({ session_id: "other", submitted: true })],
      [
        reset({ status: "contest_period" }),
        reset({ request_id: "voted", voted: true }),
      ],
    );

    expect(actionableCount(items)).toBe(1);
  });

  it("treats a contest_period reset as informational, never as a vote prompt", () => {
    const [item] = buildInbox([], [reset({ status: "contest_period" })]);

    expect(item.actionable).toBe(false);
    expect(item.detail).toMatch(/contest period/i);
  });

  it("marks an already-submitted share as done rather than hiding it", () => {
    const [item] = buildInbox([session({ submitted: true })], []);

    expect(item.actionable).toBe(false);
    expect(item.detail).toMatch(/already sent/i);
  });

  it("reports a recovery session as expired once its 30 minutes are up", () => {
    const [item] = buildInbox([session()], []);

    expect(hasExpired(item, new Date("2026-07-26T12:15:00Z"))).toBe(false);
    expect(hasExpired(item, new Date("2026-07-26T13:00:00Z"))).toBe(true);
  });

  it("has no expiry for a PIN reset — its clock is the 48h contest period", () => {
    const [item] = buildInbox([], [reset()]);
    expect(item.expiresAt).toBeUndefined();
  });
});

describe("turning on the second factor", () => {
  const mnemonic = vectors.seed_and_user_address.mnemonic;
  const pin = vectors.server_auth_token.pin;

  it("accepts a valid phrase and PIN together", () => {
    expect(checkUpgrade(mnemonic, pin, pin)).toEqual({ ok: true });
  });

  it("checks the phrase before the PIN — a wrong phrase is the useless half", () => {
    const result = checkUpgrade(
      "not a recovery phrase at all here ok",
      pin,
      pin,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/12 or 24 words/);
  });

  it("applies the same PIN rules as onboarding", () => {
    expect(checkUpgrade(mnemonic, "123456", "123456")).toMatchObject({
      ok: false,
    });
    expect(checkUpgrade(mnemonic, pin, "999999")).toMatchObject({ ok: false });
  });

  it("says the upgrade is one-way, in the same words as onboarding", () => {
    expect(SECOND_FACTOR_COPY.offered.oneWayDoor).toBe(MODE_COPY.oneWayDoor);
    expect(SECOND_FACTOR_COPY.enabled.oneWayDoor).toBe(MODE_COPY.oneWayDoor);
  });

  it("never offers to turn the second factor off", () => {
    expect(JSON.stringify(SECOND_FACTOR_COPY)).not.toMatch(
      /disable|remove the PIN|turn off/i,
    );
  });

  it("explains why the phrase is asked for — the local copy is re-sealed under the new PIN", () => {
    expect(SECOND_FACTOR_COPY.offered.phrasePrompt).toMatch(/re-encrypts/);
    expect(SECOND_FACTOR_COPY.phraseMismatch).toMatch(/different account/);
  });

  it("describes the upgrade as a sign-in requirement, not as gaining a local PIN", () => {
    // Both modes have a PIN now, so "adds a PIN to this device" would be false —
    // what changes is that the server starts requiring it too.
    expect(SECOND_FACTOR_COPY.offered.summary).toMatch(/to sign in/);
    expect(SECOND_FACTOR_COPY.enabledNotice).toMatch(
      /required to sign in anywhere/,
    );
  });
});

describe("leaving a session", () => {
  it("offers logging out in both modes — it is never the only thing missing", () => {
    for (const remembers of [true, false]) {
      expect(sessionExits(remembers).map((exit) => exit.id)).toContain(
        "log-out",
      );
    }
  });

  it("offers a plain lock only when the device has a phrase to come back to", () => {
    expect(sessionExits(true).map((exit) => exit.id)).toEqual([
      "lock",
      "log-out",
    ]);
    expect(sessionExits(false).map((exit) => exit.id)).toEqual(["log-out"]);
  });

  it("confirms only the log out that erases the stored phrase", () => {
    const [lock, logOut] = sessionExits(true);

    expect(lock.confirm).toBeUndefined();
    expect(lock.destructive).toBe(false);
    expect(logOut.confirm).toBeDefined();
    expect(logOut.destructive).toBe(true);
  });

  it("does not warn a Standard user about erasing something they never stored", () => {
    const [logOut] = sessionExits(false);

    expect(logOut.confirm).toBeUndefined();
    expect(logOut.destructive).toBe(false);
    expect(logOut.description).toMatch(/recovery phrase again/);
  });

  it("promises the account survives, since logging out is local only", () => {
    const [, logOut] = sessionExits(true);

    expect(logOut.confirm).toMatch(/recovery phrase/i);
    expect(logOut.confirm).toMatch(/untouched/i);
  });
});

describe("guardianship invitations are the third queue", () => {
  it("surfaces a pending invitation as something the guardian must accept", () => {
    const [item] = buildInbox([], [], [guardianship()]);

    expect(item.kind).toBe("guardian-invite");
    expect(item.id).toBe(guardianship().id);
    expect(item.ownerUsername).toBe("c71b3e9d5a02");
    expect(item.actionable).toBe(true);
    expect(item.expiresAt).toBeUndefined();
  });

  it("carries the invitation id, not the owner — that is what guardian-accept signs", () => {
    const [item] = buildInbox(
      [],
      [],
      [guardianship({ id: "ffffffff-4f89-11d3-9a0c-0305e82c3301" })],
    );
    expect(item.id).toBe("ffffffff-4f89-11d3-9a0c-0305e82c3301");
  });

  it("says what accepting costs, and that there is no decline", () => {
    const [item] = buildInbox([], [], [guardianship()]);

    expect(item.detail).toMatch(/account address/i);
    expect(item.detail).toMatch(/no way to decline/i);
  });

  it("drops rows that are already active or revoked — only invitations are requests", () => {
    const items = buildInbox(
      [],
      [],
      [
        guardianship({ id: "a-active", status: "active" }),
        guardianship({ id: "a-revoked", status: "revoked" }),
        guardianship(),
      ],
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(guardianship().id);
  });

  it("sits alongside the other two queues and counts toward what is waiting", () => {
    const items = buildInbox([session()], [reset()], [guardianship()]);

    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.kind))).toEqual(
      new Set(["guardian-invite", "recovery-session", "pin-reset"]),
    );
    expect(actionableCount(items)).toBe(3);
  });

  it("has an Accept label distinct from approving a PIN reset", () => {
    expect(INBOX_ACTION_LABELS["guardian-invite"].idle).toBe("Accept");
    expect(INBOX_ACTION_LABELS["guardian-invite"].idle).not.toBe(
      INBOX_ACTION_LABELS["pin-reset"].idle,
    );
    expect(Object.keys(INBOX_ACTION_LABELS).sort()).toEqual([
      "guardian-invite",
      "pin-reset",
      "recovery-session",
    ]);
  });
});

describe("the vault index", () => {
  function meta(overrides: Partial<SecretMetaRecord> = {}): SecretMetaRecord {
    return {
      id: "0c892e57-93cf-423a-a9e9-fee5a9f87681",
      ciphertext_sha256: "aa".repeat(32),
      ciphertext_bytes: 2048,
      version: "v1",
      created_at: "2026-07-26T12:00:00Z",
      updated_at: "2026-07-26T12:00:00Z",
      ...overrides,
    };
  }

  it("renders newest first", () => {
    const index = buildVaultIndex([
      meta({ id: "old", updated_at: "2026-07-20T12:00:00Z" }),
      meta({ id: "new", updated_at: "2026-07-28T12:00:00Z" }),
    ]);

    expect(index.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  describe("the opened rows the list renders", () => {
    function record(overrides: Partial<SecretRecord> = {}): SecretRecord {
      return {
        id: "0c892e57-93cf-423a-a9e9-fee5a9f87681",
        ciphertext: "AQIDBA==",
        wrapped_dek: "x",
        version: "v1",
        created_at: "2026-07-26T12:00:00Z",
        updated_at: "2026-07-26T12:00:00Z",
        ...overrides,
      };
    }

    it("carries the name and value out of the decrypted payload, newest first", () => {
      const rows = buildVaultRows([
        {
          record: record({ id: "old", updated_at: "2026-07-20T12:00:00Z" }),
          plaintext: encodeSecretPayload({ name: "older", value: "a" }),
        },
        {
          record: record({ id: "new", updated_at: "2026-07-28T12:00:00Z" }),
          plaintext: encodeSecretPayload({ name: "newer", value: "b" }),
        },
      ]);

      expect(rows.map((row) => [row.id, row.name, row.value])).toEqual([
        ["new", "newer", "b"],
        ["old", "older", "a"],
      ]);
      expect(rows.every((row) => row.readable)).toBe(true);
    });

    it("sizes each row from the ciphertext it received", () => {
      const [row] = buildVaultRows([
        {
          record: record({ ciphertext: "AAAA" }),
          plaintext: encodeSecretPayload({ name: "n", value: "v" }),
        },
      ]);

      expect(row.bytes).toBe(4);
    });

    it("keeps an item that will not decrypt in the list instead of dropping the whole vault", () => {
      const rows = buildVaultRows([
        { record: record({ id: "broken" }) },
        {
          record: record({ id: "fine", updated_at: "2026-07-28T12:00:00Z" }),
          plaintext: encodeSecretPayload({ name: "fine", value: "v" }),
        },
      ]);

      expect(rows.map((row) => row.id)).toEqual(["fine", "broken"]);
      expect(rows[1]).toMatchObject({
        name: UNREADABLE_SECRET_NAME,
        value: "",
        readable: false,
      });
    });

    it("treats a payload this UI did not write as unreadable rather than throwing", () => {
      const [row] = buildVaultRows([
        { record: record(), plaintext: "not json" },
      ]);

      expect(row).toMatchObject({
        name: UNREADABLE_SECRET_NAME,
        readable: false,
      });
    });
  });

  it("hashes the ciphertext it received rather than trusting the reported digest", async () => {
    const [entry] = buildVaultIndex([meta()]);
    const secret: SecretRecord = {
      id: entry.id,
      ciphertext: "AQIDBA==",
      wrapped_dek: "x",
      version: "v1",
      created_at: entry.updatedAt,
      updated_at: entry.updatedAt,
    };

    const result = await checkIntegrity(secret, entry);

    expect(result.matches).toBe(false);
    expect(result.hash).not.toBe(entry.reportedHash);
  });

  it("reports a match when the received bytes really do hash to the reported digest", async () => {
    const ciphertext = "AQIDBA==";
    const secret: SecretRecord = {
      id: "x",
      ciphertext,
      wrapped_dek: "x",
      version: "v1",
      created_at: "2026-07-26T12:00:00Z",
      updated_at: "2026-07-26T12:00:00Z",
    };

    const probe = await checkIntegrity(secret, buildVaultIndex([meta()])[0]);
    const [entry] = buildVaultIndex([meta({ ciphertext_sha256: probe.hash })]);

    expect((await checkIntegrity(secret, entry)).matches).toBe(true);
  });

  it("formats sizes for the index", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB");
  });

  it("round-trips the local name/value presentation format", () => {
    const payload = { name: "GitHub token", value: "ghp_example" };

    expect(decodeSecretPayload(encodeSecretPayload(payload))).toEqual(payload);
  });

  it("rejects plaintext this vault UI did not write rather than showing a wrong value", () => {
    expect(() => decodeSecretPayload("not json")).toThrow(
      MalformedSecretPayloadError,
    );
    expect(() =>
      decodeSecretPayload(JSON.stringify({ name: "only a name" })),
    ).toThrow(MalformedSecretPayloadError);
  });
});

describe("the Recovery Kit surface for share 0", () => {
  const share = new Uint8Array(33).map((_, index) => index * 7);

  it("round-trips a share through its printable form", async () => {
    const encoded = await encodeRecoveryKitShare(share);
    expect(await decodeRecoveryKitShare(encoded)).toEqual(share);
  });

  it("carries a version prefix so a later format change is detectable", async () => {
    expect(await encodeRecoveryKitShare(share)).toMatch(
      new RegExp(`^${RECOVERY_KIT_PREFIX}-`),
    );
  });

  it("reads back a share the user retyped with different spacing and case", async () => {
    const encoded = await encodeRecoveryKitShare(share);
    const retyped = `  ${encoded.toLowerCase().replace(/-/g, " ")}  `;

    expect(await decodeRecoveryKitShare(retyped)).toEqual(share);
  });

  it("catches a single mistyped character instead of returning a wrong share", async () => {
    const encoded = await encodeRecoveryKitShare(share);
    const index = encoded.length - 8;
    const wrong = encoded[index] === "A" ? "B" : "A";
    const broken = `${encoded.slice(0, index)}${wrong}${encoded.slice(index + 1)}`;

    await expect(decodeRecoveryKitShare(broken)).rejects.toThrow(
      RecoveryKitParseError,
    );
  });

  it("rejects text that is not a Recovery Kit share at all", async () => {
    await expect(decodeRecoveryKitShare("hello world")).rejects.toThrow(
      RecoveryKitParseError,
    );
  });

  it("renders a kit that states the scheme and never claims it can be reissued", async () => {
    const kit = await renderRecoveryKit(share, {
      username: "3f1c8a2b9d4e",
      userAddress: OWNER_ADDRESS,
      threshold: 2,
      totalShares: 3,
      guardianUsernames: ["alice1234abcd", "bob5678efgh"],
      createdAt: new Date("2026-08-06T00:00:00Z"),
    });

    expect(kit).toMatch(/2-of-3/);
    expect(kit).toMatch(/alice1234abcd, bob5678efgh/);
    expect(kit).toMatch(/cannot reissue it/);
    expect(kit).toContain(await encodeRecoveryKitShare(share));
  });
});
