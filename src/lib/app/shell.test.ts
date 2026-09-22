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
  accountInitial,
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

  it("says, before the call, that the change is one-way and a forgotten account PIN ends the account", () => {
    expect(SECOND_FACTOR_COPY.offered.oneWayDoor).toMatch(/no way back to Standard/);
    expect(SECOND_FACTOR_COPY.offered.oneWayDoor).toMatch(/lost for ever/);
    expect(SECOND_FACTOR_COPY.offered.oneWayDoor).toMatch(/deliberate choice, not a lesser one/);
    expect(SECOND_FACTOR_COPY.enabled.oneWayDoor).toMatch(/no reset/);
    expect(MODE_COPY.oneWayDoor).toMatch(/lost for ever/);
  });

  it("never offers to turn the second factor off", () => {
    expect(JSON.stringify(SECOND_FACTOR_COPY)).not.toMatch(
      /disable|remove the PIN|turn off/i,
    );
  });

  it("explains why the phrase is asked for — it signs the change and is not kept", () => {
    expect(SECOND_FACTOR_COPY.offered.phrasePrompt).toMatch(/signs this change/);
    expect(SECOND_FACTOR_COPY.offered.phrasePrompt).toMatch(/does not keep it/);
    expect(SECOND_FACTOR_COPY.phraseMismatch).toMatch(/different account/);
  });

  it("describes Paranoid as a PIN on everything the phrase alone could do, not as a sign-in step", () => {
    expect(SECOND_FACTOR_COPY.offered.summary).toMatch(/adding a device/);
    expect(SECOND_FACTOR_COPY.offered.summary).not.toMatch(/to sign in/);
    expect(SECOND_FACTOR_COPY.enabledNotice).toMatch(/whenever your recovery phrase is used/);
  });
});

describe("leaving a session", () => {
  it("offers both ways to leave, and says which one each is", () => {
    expect(sessionExits().map((exit) => exit.id)).toEqual(["lock", "remove-browser"]);
  });

  it("locks without asking, because the device stays and the PIN brings you back", () => {
    const [lock] = sessionExits();
    expect(lock.confirm).toBeUndefined();
    expect(lock.destructive).toBe(false);
    expect(lock.description).toMatch(/PIN/);
  });

  it("confirms removing this browser, and says the phrase is then needed", () => {
    const [, remove] = sessionExits();
    expect(remove.destructive).toBe(true);
    expect(remove.confirm).toMatch(/recovery phrase/i);
    expect(remove.confirm).toMatch(/untouched/i);
    expect(remove.description).toMatch(/recovery phrase/);
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
        key_generation: 1,
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
      key_generation: 1,
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
      key_generation: 1,
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


describe("the shell's account chrome", () => {
  it("takes the avatar letter from the username, falling back rather than rendering blank", () => {
    expect(accountInitial("ada")).toBe("A");
    expect(accountInitial("  ")).toBe("?");
    expect(accountInitial(undefined)).toBe("?");
  });
});
