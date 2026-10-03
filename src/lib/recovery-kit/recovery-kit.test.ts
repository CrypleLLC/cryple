import { describe, expect, it } from "vitest";
import { wordlists } from "bip39";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  type PDFObject,
} from "pdf-lib";
import vectors from "@/test/fixtures/test-vectors.json";
import { generateMnemonic } from "@/lib/keys";
import {
  buildRecoveryKitPdf,
  qrModulePath,
  RECOVERY_KIT_COPY,
  RECOVERY_KIT_QR_QUIET_ZONE_MODULES,
  recoveryKitContent,
  recoveryKitFileName,
  recoveryKitGridCell,
  recoveryKitPhrase,
  RecoveryKitGlyphError,
  recoveryKitQrModules,
  recoveryKitWordOutlines,
} from "./index";
import { GLYPH_ADVANCE } from "./glyphs";

const mnemonic = vectors.seed_and_user_address.mnemonic;
const username = "3f1c8a2b9d4e";
const createdAt = new Date("2026-09-13T10:00:00Z");

async function shownStrings(bytes: Uint8Array): Promise<string[]> {
  const document = await PDFDocument.load(bytes);
  const contents = document.getPage(0).node.Contents();
  const streams: PDFObject[] =
    contents instanceof PDFArray ? contents.asArray() : [contents!];
  const operators = streams
    .map((reference) => document.context.lookup(reference))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) =>
      new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()),
    )
    .join("\n");

  return [...operators.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map(([, hex]) =>
    String.fromCharCode(
      ...(hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)),
    ),
  );
}

describe("what the recovery kit carries", () => {
  it("names the app, the account, the date and every word in order", () => {
    const content = recoveryKitContent({ username, mnemonic, createdAt });

    expect(content.appName).toBe("Zekke");
    expect(content.username).toBe(username);
    expect(content.created).toBe("2026-09-13");
    expect(content.words.map(({ word }) => word).join(" ")).toBe(mnemonic);
    expect(content.words.map(({ position }) => position)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  it("puts exactly the phrase in the QR code, in the form sign-in accepts", () => {
    const untidy = `  ${mnemonic.replace(/ /g, "   ")}\n`;

    expect(
      recoveryKitContent({ username, mnemonic: untidy, createdAt }).qrPayload,
    ).toBe(mnemonic);
  });

  it("has no field a PIN could be written into", () => {
    const content = recoveryKitContent({ username, mnemonic, createdAt });

    expect(Object.keys(content).sort()).toEqual([
      "appName",
      "created",
      "heading",
      "intro",
      "qrCaption",
      "qrPayload",
      "username",
      "warning",
      "words",
    ]);
    expect(JSON.stringify(content)).not.toContain(vectors.pin_oprf.pin);
    expect(JSON.stringify(RECOVERY_KIT_COPY)).not.toMatch(/\bPIN\b/i);
  });

  it("refuses to print a phrase that fails its checksum", () => {
    const broken = Array.from({ length: 12 }, () => "abandon").join(" ");

    expect(() => recoveryKitPhrase(broken)).toThrow();
  });
});

describe("the QR code", () => {
  it("is square and keeps its quiet zone clear", () => {
    const modules = recoveryKitQrModules(mnemonic);
    const quiet = RECOVERY_KIT_QR_QUIET_ZONE_MODULES;

    expect(modules.every((row) => row.length === modules.length)).toBe(true);
    for (let offset = 0; offset < quiet; offset += 1) {
      expect(modules[offset].some(Boolean)).toBe(false);
      expect(modules[modules.length - 1 - offset].some(Boolean)).toBe(false);
      expect(
        modules.some((row) => row[offset] || row[row.length - 1 - offset]),
      ).toBe(false);
    }
  });

  it("draws each run of dark modules as one rectangle of one path", () => {
    expect(
      qrModulePath([
        [true, true, false, true],
        [false, true, true, false],
        [false, false, false, false],
      ]),
    ).toBe("M0 0H2V1H0ZM3 0H4V1H3ZM1 1H3V2H1Z");
  });
});

describe("the phrase grid", () => {
  it("fills columns top to bottom, so the numbers read down each column", () => {
    expect(recoveryKitGridCell(0, 12)).toEqual({ column: 0, row: 0 });
    expect(recoveryKitGridCell(3, 12)).toEqual({ column: 0, row: 3 });
    expect(recoveryKitGridCell(4, 12)).toEqual({ column: 1, row: 0 });
    expect(recoveryKitGridCell(11, 12)).toEqual({ column: 2, row: 3 });
    expect(recoveryKitGridCell(23, 24)).toEqual({ column: 2, row: 7 });
  });
});

describe("the phrase outlines", () => {
  it("has an outline for every letter of every BIP-39 English word", () => {
    for (const word of wordlists.english!) {
      expect(recoveryKitWordOutlines(word)).toHaveLength(word.length);
    }
  });

  it("places each letter one monospaced advance after the last", () => {
    expect(recoveryKitWordOutlines("abc").map(({ offset }) => offset)).toEqual([
      0,
      GLYPH_ADVANCE,
      2 * GLYPH_ADVANCE,
    ]);
  });

  it("refuses a character it has no outline for rather than dropping it", () => {
    expect(() => recoveryKitWordOutlines("abç")).toThrow(RecoveryKitGlyphError);
  });
});

describe("the PDF", () => {
  it("is one titled page", async () => {
    const bytes = await buildRecoveryKitPdf({ username, mnemonic, createdAt });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe(RECOVERY_KIT_COPY.documentTitle);
  });

  it("still fits on one page with 24 words and the longest username", async () => {
    const bytes = await buildRecoveryKitPdf({
      username: "a".repeat(64),
      mnemonic: generateMnemonic(24),
      createdAt,
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("draws the phrase as outlines, so no word of it can be selected, searched or extracted", async () => {
    const phrase = generateMnemonic(24);
    const bytes = await buildRecoveryKitPdf({
      username,
      mnemonic: phrase,
      createdAt,
    });
    const shown = await shownStrings(bytes);

    expect(shown).toContain(RECOVERY_KIT_COPY.heading);
    expect(shown.join(" ")).toContain(
      "cannot be selected or copied, on purpose.",
    );
    for (const word of phrase.split(" ")) {
      expect(shown).not.toContain(word);
    }
    expect(shown.join(" ")).not.toContain(
      phrase.split(" ").slice(0, 3).join(" "),
    );
  });

  it("embeds no font for the phrase", async () => {
    const bytes = await buildRecoveryKitPdf({ username, mnemonic, createdAt });

    expect(new TextDecoder("latin1").decode(bytes)).not.toMatch(/Courier/);
  });

  it("is named after the account", () => {
    expect(recoveryKitFileName(username)).toBe(
      "zekke-recovery-kit-3f1c8a2b9d4e.pdf",
    );
  });
});
