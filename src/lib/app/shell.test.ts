import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/test-vectors.json";
import type { SecretMetaRecord, SecretRecord } from "@/lib/secrets";

import {
  buildVaultIndex,
  buildVaultRows,
  checkIntegrity,
  checkUpgrade,
  decodeSecretPayload,
  encodeSecretPayload,
  formatBytes,
  MalformedSecretPayloadError,
  MODE_COPY,
  SECOND_FACTOR_COPY,
  sessionExits,
  UNREADABLE_SECRET_NAME,
} from "./index";


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

