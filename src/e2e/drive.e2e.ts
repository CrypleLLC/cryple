import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { ApiError, TokenStore } from "@/lib/api";
import {
  completeSignUp,
  draftSignUp,
  enrolThisBrowser,
  type AccountServices,
} from "@/lib/account";
import type { AuthedContext } from "@/lib/context";
import { memoryDeviceStore } from "@/lib/device/store";
import { bytesToHex } from "@/lib/encoding";
import {
  abandonUpload,
  decryptStream,
  deleteFile,
  fetchPutter,
  getFileDownload,
  listFiles,
  openFile,
  PartUploadError,
  resumeUpload,
  uploadFile,
  type PartPutter,
  type UploadFile,
} from "@/lib/files";
import { generateMnemonic } from "@/lib/keys";
import { SessionKeystore } from "@/lib/session";
import { listTrash, purgeEntries, restoreEntries } from "@/lib/trash";
import { getMe } from "@/lib/users";

const MiB = 1 << 20;
const SIZE = Number(process.env.ZEKKE_E2E_DRIVE_BYTES ?? 1024 * MiB);
const DROP_AFTER_PARTS = 40;
const LONG = 30 * 60 * 1000;
const REPLICA = process.env.ZEKKE_E2E_REPLICA !== "off";

function services(): AccountServices {
  return {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
}

function context(account: AccountServices): AuthedContext {
  return { session: account.session, tokens: account.tokens, paranoid: false };
}

function block(seed: number, index: number, length: number): Uint8Array {
  const words = new Uint32Array(Math.ceil(length / 4));
  let state = (seed ^ Math.imul(index + 1, 2654435761)) >>> 0 || 1;
  for (let at = 0; at < words.length; at += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    words[at] = state >>> 0;
  }
  return new Uint8Array(words.buffer, 0, length);
}

function generated(name: string, size: number, seed: number): UploadFile {
  return {
    name,
    type: "application/octet-stream",
    size,
    stream: () => {
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          const offset = index * MiB;
          if (offset >= size) {
            controller.close();
            return;
          }
          controller.enqueue(block(seed, index, Math.min(MiB, size - offset)));
          index += 1;
        },
      });
    },
  };
}

async function digestOf(
  stream: ReadableStream<Uint8Array>,
): Promise<{ hex: string; length: number }> {
  const hash = sha256.create();
  const reader = stream.getReader();
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { hex: bytesToHex(hash.digest()), length };
    }
    hash.update(value);
    length += value.length;
  }
}

function countingPutter(dropAfter?: number) {
  const counter = { puts: 0 };
  const put: PartPutter = async (part, body, signal) => {
    if (dropAfter !== undefined && counter.puts >= dropAfter) {
      throw new TypeError("Failed to fetch");
    }
    await fetchPutter(part, body, signal);
    counter.puts += 1;
  };
  return { counter, put };
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for the storage worker");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

describe("the drive, end to end against an S3 store", () => {
  let owner: AccountServices;
  let mnemonic: string;
  let fileId: string;
  let expected: { hex: string; length: number };
  const big = generated("big.bin", SIZE, 0x5eed);

  beforeAll(async () => {
    owner = services();
    mnemonic = generateMnemonic(12);
    await completeSignUp(owner, await draftSignUp(mnemonic), {
      pin: "482915",
      paranoid: false,
    });
    expected = await digestOf(big.stream());
  }, LONG);

  it(
    "survives a connection dropped mid-upload and resumes only what is missing",
    { timeout: LONG },
    async () => {
      const ctx = context(owner);
      fileId = crypto.randomUUID();

      const dropped = countingPutter(DROP_AFTER_PARTS);
      await expect(
        uploadFile(ctx, big, { id: fileId, put: dropped.put, concurrency: 1 }),
      ).rejects.toThrow();
      expect(dropped.counter.puts).toBe(DROP_AFTER_PARTS);

      const pending = (await listFiles(ctx)).find(
        (file) => file.id === fileId,
      )!;
      expect(pending.r2_state).toBe("pending");

      const resumed = countingPutter();
      const stored = await resumeUpload(ctx, pending, big, {
        put: resumed.put,
      });
      expect(stored.r2_state).toBe("ok");

      const totalParts = Math.ceil(stored.size_bytes / (8 * MiB + 37));
      expect(resumed.counter.puts).toBe(totalParts - DROP_AFTER_PARTS);
    },
  );

  it(
    "downloads byte-identical on a second device, streaming, with the digest checked",
    { timeout: LONG },
    async () => {
      const second = services();
      await enrolThisBrowser(second, { mnemonic, pin: "962730" });
      const ctx = context(second);

      const opened = await openFile(ctx, fileId);
      const response = await fetch(opened.record.url);
      expect(response.ok).toBe(true);
      const plaintext = decryptStream(
        response.body!,
        opened.manifest,
        opened.dek,
        {
          expectedSha256: opened.record.ciphertext_sha256,
          ownsDek: true,
        },
      );

      expect(await digestOf(plaintext)).toEqual(expected);
    },
  );

  it("gives another account nothing, not even the presigned URL", async () => {
    const stranger = services();
    await completeSignUp(stranger, await draftSignUp(generateMnemonic(12)), {
      pin: "749315",
      paranoid: false,
    });

    await expect(
      getFileDownload(context(stranger), fileId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.runIf(REPLICA)(
    "is copied to the replica by the storage worker",
    { timeout: LONG },
    async () => {
      const ctx = context(owner);
      const replicated = await until(
        () => getFileDownload(ctx, fileId),
        (file) => file.gcs_state === "ok",
        LONG - 60_000,
      );
      expect(replicated.r2_state).toBe("ok");
    },
  );

  it(
    "refuses a part whose length is not the one the URL was signed for",
    { timeout: LONG },
    async () => {
      const ctx = context(owner);
      const id = crypto.randomUUID();
      const padded: PartPutter = async (part, body, signal) => {
        const longer = new Uint8Array(body.length + 1);
        longer.set(body);
        await fetchPutter(part, longer, signal);
      };

      const rejected = await uploadFile(
        ctx,
        generated("wrong-length.bin", 9 * MiB, 7),
        { id, put: padded },
      ).catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(PartUploadError);
      expect((rejected as PartUploadError).status).toBe(403);

      await abandonUpload(ctx, id);
      expect((await listFiles(ctx)).some((file) => file.id === id)).toBe(false);
    },
  );

  it(
    "goes to the Trash, comes back, and leaves for good once purged",
    { timeout: LONG },
    async () => {
      const ctx = context(owner);
      if ((await getMe(ctx)).retention_days === 0) {
        return;
      }

      await deleteFile(ctx, fileId);
      let { entries } = await listTrash(ctx, ["files"]);
      expect(entries.map((entry) => [entry.id, entry.name])).toEqual([
        [fileId, "big.bin"],
      ]);

      await restoreEntries(ctx, entries);
      expect((await getFileDownload(ctx, fileId)).r2_state).toBe("ok");

      await deleteFile(ctx, fileId);
      ({ entries } = await listTrash(ctx, ["files"]));
      expect(await purgeEntries(ctx, entries)).toBe(1);
      expect((await listTrash(ctx, ["files"])).entries).toEqual([]);
      await expect(getFileDownload(ctx, fileId)).rejects.toBeInstanceOf(
        ApiError,
      );
    },
  );
});
