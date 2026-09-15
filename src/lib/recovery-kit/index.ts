import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { encode } from 'uqr';
import { assertValidMnemonic } from '@/lib/keys';

export const RECOVERY_KIT_COPY = {
  appName: 'Cryple',
  heading: 'Recovery Kit',
  documentTitle: 'Cryple Recovery Kit',
  intro:
    'Your recovery phrase is your account. Keep this document offline: printed, or on a storage ' +
    'device that never connects to the internet.',
  usernameLabel: 'Username',
  createdLabel: 'Created',
  phraseLabel: 'Recovery phrase',
  qrCaption: 'Scan with the Cryple mobile app to sign in.',
  warning:
    'Anyone who holds this document can open your vault. Cryple never sees this phrase and cannot ' +
    'reset or recover it: if you lose it, nobody can restore it for you.',
} as const;

export const RECOVERY_KIT_QR_ERROR_CORRECTION = 'M';
export const RECOVERY_KIT_QR_QUIET_ZONE_MODULES = 4;
export const RECOVERY_KIT_PHRASE_COLUMNS = 3;

export interface RecoveryKitInput {
  username: string;
  mnemonic: string;
  createdAt: Date;
}

export interface RecoveryKitWord {
  position: number;
  word: string;
}

export interface RecoveryKitContent {
  appName: string;
  heading: string;
  intro: string;
  username: string;
  created: string;
  words: RecoveryKitWord[];
  qrPayload: string;
  qrCaption: string;
  warning: string;
}

export class RecoveryKitOverflowError extends Error {
  constructor() {
    super('recovery kit content does not fit on one page');
    this.name = 'RecoveryKitOverflowError';
  }
}

export function recoveryKitPhrase(mnemonic: string): string {
  assertValidMnemonic(mnemonic);

  return mnemonic.normalize('NFKD').trim().split(/\s+/).join(' ');
}

export function recoveryKitContent(input: RecoveryKitInput): RecoveryKitContent {
  const phrase = recoveryKitPhrase(input.mnemonic);

  return {
    appName: RECOVERY_KIT_COPY.appName,
    heading: RECOVERY_KIT_COPY.heading,
    intro: RECOVERY_KIT_COPY.intro,
    username: input.username,
    created: input.createdAt.toISOString().slice(0, 10),
    words: phrase.split(' ').map((word, index) => ({ position: index + 1, word })),
    qrPayload: phrase,
    qrCaption: RECOVERY_KIT_COPY.qrCaption,
    warning: RECOVERY_KIT_COPY.warning,
  };
}

export function recoveryKitQrModules(payload: string): boolean[][] {
  return encode(payload, {
    ecc: RECOVERY_KIT_QR_ERROR_CORRECTION,
    border: RECOVERY_KIT_QR_QUIET_ZONE_MODULES,
  }).data;
}

export function qrModulePath(modules: readonly (readonly boolean[])[]): string {
  const runs: string[] = [];

  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      runs.push(`M${start} ${y}H${x}V${y + 1}H${start}Z`);
    }
  });

  return runs.join('');
}

export function recoveryKitGridCell(
  index: number,
  wordCount: number,
  columns = RECOVERY_KIT_PHRASE_COLUMNS,
): { column: number; row: number } {
  const rows = Math.ceil(wordCount / columns);

  return { column: Math.floor(index / rows), row: index % rows };
}

export function recoveryKitFileName(username: string): string {
  return `cryple-recovery-kit-${username}.pdf`;
}

const A4_PAGE: [number, number] = [595.28, 841.89];
const PAGE_MARGIN = 56;
const QR_SIZE = 168;
const PHRASE_ROW_HEIGHT = 26;
const PHRASE_BOX_PADDING = 16;
const PHRASE_WORD_SIZE = 13;
const BODY_SIZE = 10.5;
const BODY_LINE_HEIGHT = 15;
const LABEL_SIZE = 9;
const SECTION_GAP = 28;

const INK = rgb(0x1f / 255, 0x29 / 255, 0x37 / 255);
const INK_MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const BRAND = rgb(0x4f / 255, 0x46 / 255, 0xe5 / 255);
const RULE = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);
const QR_INK = rgb(0, 0, 0);
const WARNING_TEXT = rgb(0xb4 / 255, 0x53 / 255, 0x09 / 255);
const WARNING_BACKGROUND = rgb(0xff / 255, 0xfb / 255, 0xeb / 255);
const WARNING_RULE = rgb(0xfd / 255, 0xe6 / 255, 0x8a / 255);

interface KitFonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';

  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') {
    lines.push(line);
  }

  return lines;
}

function fittedSize(text: string, font: PDFFont, preferred: number, maxWidth: number): number {
  const minimum = 8;
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.5;
  }

  return size;
}

function drawParagraph(
  page: PDFPage,
  text: string,
  options: { x: number; top: number; width: number; font: PDFFont; color: typeof INK },
): number {
  let baseline = options.top - BODY_SIZE;
  for (const line of wrapText(text, options.font, BODY_SIZE, options.width)) {
    page.drawText(line, {
      x: options.x,
      y: baseline,
      size: BODY_SIZE,
      font: options.font,
      color: options.color,
    });
    baseline -= BODY_LINE_HEIGHT;
  }

  return baseline + BODY_LINE_HEIGHT - 4;
}

function drawField(
  page: PDFPage,
  fonts: KitFonts,
  field: { label: string; value: string; valueSize: number; x: number; top: number; width: number },
): number {
  const labelBaseline = field.top - LABEL_SIZE;
  page.drawText(field.label.toUpperCase(), {
    x: field.x,
    y: labelBaseline,
    size: LABEL_SIZE,
    font: fonts.bold,
    color: INK_MUTED,
  });

  const valueSize = fittedSize(field.value, fonts.bold, field.valueSize, field.width);
  const valueBaseline = labelBaseline - 8 - valueSize;
  page.drawText(field.value, {
    x: field.x,
    y: valueBaseline,
    size: valueSize,
    font: fonts.bold,
    color: INK,
  });

  return valueBaseline - 4;
}

function drawHeader(page: PDFPage, fonts: KitFonts, content: RecoveryKitContent, top: number): number {
  const [width] = A4_PAGE;

  const titleBaseline = top - 28;
  page.drawText(content.appName, {
    x: PAGE_MARGIN,
    y: titleBaseline,
    size: 28,
    font: fonts.bold,
    color: BRAND,
  });

  const headingBaseline = titleBaseline - 12 - 14;
  page.drawText(content.heading, {
    x: PAGE_MARGIN,
    y: headingBaseline,
    size: 14,
    font: fonts.regular,
    color: INK_MUTED,
  });

  const ruleY = headingBaseline - 18;
  page.drawLine({
    start: { x: PAGE_MARGIN, y: ruleY },
    end: { x: width - PAGE_MARGIN, y: ruleY },
    thickness: 1,
    color: RULE,
  });

  return ruleY - SECTION_GAP;
}

function drawIdentity(
  page: PDFPage,
  fonts: KitFonts,
  content: RecoveryKitContent,
  top: number,
): number {
  const [width] = A4_PAGE;
  const qrLeft = width - PAGE_MARGIN - QR_SIZE;
  const columnWidth = qrLeft - PAGE_MARGIN - 24;

  let left = drawField(page, fonts, {
    label: RECOVERY_KIT_COPY.usernameLabel,
    value: content.username,
    valueSize: 16,
    x: PAGE_MARGIN,
    top,
    width: columnWidth,
  });
  left = drawField(page, fonts, {
    label: RECOVERY_KIT_COPY.createdLabel,
    value: content.created,
    valueSize: 12,
    x: PAGE_MARGIN,
    top: left - 18,
    width: columnWidth,
  });
  left = drawParagraph(page, content.intro, {
    x: PAGE_MARGIN,
    top: left - 18,
    width: columnWidth,
    font: fonts.regular,
    color: INK_MUTED,
  });

  const modules = recoveryKitQrModules(content.qrPayload);
  page.drawSvgPath(qrModulePath(modules), {
    x: qrLeft,
    y: top,
    scale: QR_SIZE / modules.length,
    color: QR_INK,
  });

  const captionWidth = QR_SIZE + 32;
  let captionBaseline = top - QR_SIZE - 6 - LABEL_SIZE;
  for (const line of wrapText(content.qrCaption, fonts.regular, LABEL_SIZE, captionWidth)) {
    const lineWidth = fonts.regular.widthOfTextAtSize(line, LABEL_SIZE);
    page.drawText(line, {
      x: Math.min(qrLeft + (QR_SIZE - lineWidth) / 2, width - PAGE_MARGIN - lineWidth),
      y: captionBaseline,
      size: LABEL_SIZE,
      font: fonts.regular,
      color: INK_MUTED,
    });
    captionBaseline -= LABEL_SIZE + 3;
  }

  return Math.min(left, captionBaseline) - SECTION_GAP;
}

function drawPhrase(page: PDFPage, fonts: KitFonts, content: RecoveryKitContent, top: number): number {
  const [width] = A4_PAGE;
  const boxWidth = width - 2 * PAGE_MARGIN;

  page.drawText(RECOVERY_KIT_COPY.phraseLabel.toUpperCase(), {
    x: PAGE_MARGIN,
    y: top - LABEL_SIZE,
    size: LABEL_SIZE,
    font: fonts.bold,
    color: INK_MUTED,
  });

  const boxTop = top - LABEL_SIZE - 12;
  const rows = Math.ceil(content.words.length / RECOVERY_KIT_PHRASE_COLUMNS);
  const boxHeight = 2 * PHRASE_BOX_PADDING + (rows - 1) * PHRASE_ROW_HEIGHT + PHRASE_WORD_SIZE;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: boxTop - boxHeight,
    width: boxWidth,
    height: boxHeight,
    borderColor: RULE,
    borderWidth: 1,
  });

  const columnWidth = (boxWidth - 2 * PHRASE_BOX_PADDING) / RECOVERY_KIT_PHRASE_COLUMNS;
  const numberWidth = 22;

  content.words.forEach(({ position, word }, index) => {
    const { column, row } = recoveryKitGridCell(index, content.words.length);
    const cellLeft = PAGE_MARGIN + PHRASE_BOX_PADDING + column * columnWidth;
    const baseline = boxTop - PHRASE_BOX_PADDING - row * PHRASE_ROW_HEIGHT - PHRASE_WORD_SIZE;
    const number = String(position);

    page.drawText(number, {
      x: cellLeft + numberWidth - fonts.regular.widthOfTextAtSize(number, LABEL_SIZE),
      y: baseline,
      size: LABEL_SIZE,
      font: fonts.regular,
      color: INK_MUTED,
    });
    page.drawText(word, {
      x: cellLeft + numberWidth + 8,
      y: baseline,
      size: PHRASE_WORD_SIZE,
      font: fonts.mono,
      color: INK,
    });
  });

  return boxTop - boxHeight - SECTION_GAP;
}

function drawWarning(page: PDFPage, fonts: KitFonts, content: RecoveryKitContent, top: number): number {
  const [width] = A4_PAGE;
  const boxWidth = width - 2 * PAGE_MARGIN;
  const padding = 14;
  const lines = wrapText(content.warning, fonts.bold, BODY_SIZE, boxWidth - 2 * padding);
  const boxHeight = 2 * padding + (lines.length - 1) * BODY_LINE_HEIGHT + BODY_SIZE;

  page.drawRectangle({
    x: PAGE_MARGIN,
    y: top - boxHeight,
    width: boxWidth,
    height: boxHeight,
    color: WARNING_BACKGROUND,
    borderColor: WARNING_RULE,
    borderWidth: 1,
  });
  drawParagraph(page, content.warning, {
    x: PAGE_MARGIN + padding,
    top: top - padding,
    width: boxWidth - 2 * padding,
    font: fonts.bold,
    color: WARNING_TEXT,
  });

  return top - boxHeight;
}

export async function buildRecoveryKitPdf(input: RecoveryKitInput): Promise<Uint8Array> {
  const content = recoveryKitContent(input);

  const document = await PDFDocument.create();
  document.setTitle(RECOVERY_KIT_COPY.documentTitle);
  document.setCreator(RECOVERY_KIT_COPY.appName);
  document.setProducer(RECOVERY_KIT_COPY.appName);
  document.setCreationDate(input.createdAt);
  document.setModificationDate(input.createdAt);

  const fonts: KitFonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    mono: await document.embedFont(StandardFonts.CourierBold),
  };

  const page = document.addPage(A4_PAGE);
  const [, height] = A4_PAGE;

  let top = drawHeader(page, fonts, content, height - PAGE_MARGIN);
  top = drawIdentity(page, fonts, content, top);
  top = drawPhrase(page, fonts, content, top);
  top = drawWarning(page, fonts, content, top);

  if (top < PAGE_MARGIN) {
    throw new RecoveryKitOverflowError();
  }

  return document.save();
}
