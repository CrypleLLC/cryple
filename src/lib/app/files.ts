import { formatBytes } from "./vault";
import { daysLabel } from "./trash";
import { countOf, FILE_NOUNS, type FolderNouns } from "./folders";
import type { FileRecord, StorageUsage, UploadProgress } from "@/lib/files";

export const UNREADABLE_FILE_NAME = "Unreadable file";
export const FILE_NAME_MAX_CHARACTERS = 80;

const ELLIPSIS = "…";

export function fileName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return UNREADABLE_FILE_NAME;
  }

  const characters = Array.from(trimmed);
  return characters.length <= FILE_NAME_MAX_CHARACTERS
    ? trimmed
    : `${characters.slice(0, FILE_NAME_MAX_CHARACTERS).join("").trimEnd()}${ELLIPSIS}`;
}

export function fullFileName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length === 0 ? UNREADABLE_FILE_NAME : trimmed;
}

export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "archive"
  | "document"
  | "sheet"
  | "slides"
  | "code"
  | "text"
  | "other";

const DOCUMENT_TYPES = /msword|wordprocessingml|opendocument\.text|rtf|epub/;
const SHEET_TYPES = /ms-excel|spreadsheetml|opendocument\.spreadsheet|csv/;
const SLIDES_TYPES = /ms-powerpoint|presentationml|opendocument\.presentation/;
const ARCHIVE_TYPES = /zip|tar|gzip|bzip|rar|7z-compressed|x-xz/;
const CODE_TYPES =
  /javascript|typescript|json|xml|x-sh|x-python|x-c|x-java|yaml|sql|wasm/;

export function fileKind(mime: string): FileKind {
  const type = mime.toLowerCase();

  if (type === "application/pdf") return "pdf";
  if (DOCUMENT_TYPES.test(type)) return "document";
  if (SHEET_TYPES.test(type)) return "sheet";
  if (SLIDES_TYPES.test(type)) return "slides";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (ARCHIVE_TYPES.test(type)) return "archive";
  if (CODE_TYPES.test(type)) return "code";
  if (type.startsWith("text/")) return "text";

  return "other";
}

export const FILE_EXTENSION_MAX_CHARACTERS = 4;

export function fileExtension(name: string): string {
  const base = name.trim().split("/").pop() ?? "";
  const cut = base.lastIndexOf(".");
  if (cut <= 0 || cut === base.length - 1) {
    return "";
  }

  const extension = base.slice(cut + 1);
  return /^[A-Za-z0-9]+$/.test(extension) &&
    extension.length <= FILE_EXTENSION_MAX_CHARACTERS
    ? extension.toUpperCase()
    : "";
}

export const REPLICATION_PENDING =
  "Saved. A second copy is made within a minute.";
export const REPLICATION_DONE = "Saved, with a second copy.";
export const REPLICATION_FAILED = "Saved. The second copy has not been made.";
export const PRIMARY_MISSING =
  "This file is being repaired. It cannot be opened right now.";
export const UPLOAD_UNFINISHED =
  "This upload never finished, so the file is not in your vault.";

export function replicationLabel(
  file: Pick<FileRecord, "r2_state" | "gcs_state">,
): string {
  if (file.r2_state === "missing") {
    return PRIMARY_MISSING;
  }
  if (file.r2_state !== "ok") {
    return UPLOAD_UNFINISHED;
  }

  switch (file.gcs_state) {
    case "ok":
      return REPLICATION_DONE;
    case "failed":
      return REPLICATION_FAILED;
    default:
      return REPLICATION_PENDING;
  }
}

export function fileCaption(status: string, trueBytes: number): string {
  return status === "" || status === REPLICATION_DONE
    ? formatBytes(trueBytes)
    : status;
}

export function isOpenable(file: Pick<FileRecord, "r2_state">): boolean {
  return file.r2_state === "ok";
}

export function isResumable(file: Pick<FileRecord, "r2_state">): boolean {
  return file.r2_state === "pending";
}

export interface StorageBar {
  usedLabel: string;
  quotaLabel: string;
  summary: string;
  uploadingSummary?: string;
  percent: number;
  reservedPercent: number;
  nearlyFull: boolean;
}

export const NEARLY_FULL_AT = 0.9;

function share(bytes: number, quota: number): number {
  if (quota <= 0) {
    return 0;
  }

  return Math.round(Math.min(100, (bytes / quota) * 100) * 10) / 10;
}

export function storageBar(usage: StorageUsage): StorageBar {
  const reserved = Math.max(0, usage.used_bytes - usage.stored_bytes);
  const percent = share(usage.stored_bytes, usage.quota_bytes);

  return {
    usedLabel: formatBytes(usage.stored_bytes),
    quotaLabel: formatBytes(usage.quota_bytes),
    summary: `${formatBytes(usage.stored_bytes)} of ${formatBytes(usage.quota_bytes)} used`,
    uploadingSummary:
      reserved === 0
        ? undefined
        : `${formatBytes(reserved)} held by unfinished uploads`,
    percent,
    reservedPercent: Math.max(
      0,
      share(usage.used_bytes, usage.quota_bytes) - percent,
    ),
    nearlyFull:
      usage.quota_bytes > 0 &&
      usage.used_bytes / usage.quota_bytes >= NEARLY_FULL_AT,
  };
}

export function freeBytes(usage: StorageUsage): number {
  return Math.max(0, usage.quota_bytes - usage.used_bytes);
}

export function usedShareLabel(usage: StorageUsage): string {
  return `${storageBar(usage).percent}% of ${formatBytes(usage.quota_bytes)}`;
}

export const DELETED_SPACE_RETURNS =
  "Space from a deleted file returns within a minute, once both copies are removed.";

export const TRASHED_SPACE_RETURNS =
  "Its space is freed now, while it waits in the Trash.";

export function fileDeleteConfirmation(
  name: string,
  retentionDays = 0,
): string {
  if (retentionDays > 0) {
    return (
      `${fileName(name)} goes to the Trash, where you can restore it for ${daysLabel(retentionDays)}. ` +
      `After that it is deleted for good. ${TRASHED_SPACE_RETURNS}`
    );
  }
  return (
    `Deleting ${fileName(name)} is permanent. Only this account holds the key, so nobody — ` +
    `including Zekke — can restore it. ${DELETED_SPACE_RETURNS}`
  );
}

export function fileBatchDeleteConfirmation(
  count: number,
  retentionDays = 0,
): string {
  const files = count === 1 ? "this file" : `these ${count} files`;
  const them = count === 1 ? "it" : "them";
  if (retentionDays > 0) {
    return (
      `${count === 1 ? "This file goes" : `These ${count} files go`} to the Trash, where you can restore ` +
      `${them} for ${daysLabel(retentionDays)}. After that ${count === 1 ? "it is" : "they are"} deleted for good.`
    );
  }
  return (
    `Deleting ${files} is permanent. Only this account holds the keys, so nobody — ` +
    `including Zekke — can restore ${them}. ${DELETED_SPACE_RETURNS}`
  );
}

export function fileBatchDeleteSummary(result: {
  requested: number;
  deleted: number;
}): string | undefined {
  const missing = result.requested - result.deleted;
  if (missing <= 0) {
    return undefined;
  }

  const were = missing === 1 ? "was" : "were";
  if (result.deleted === 0) {
    return `${fileCountLabel(missing)} ${were} already gone. The list is now up to date.`;
  }
  return `Deleted ${result.deleted} of ${result.requested} — ${fileCountLabel(missing)} ${were} already gone.`;
}

export function resumeHint(name: string, remembered: boolean): string {
  return remembered
    ? `Finish uploading ${fileName(name)} — this device still has the file`
    : `Finish uploading ${fileName(name)} — pick the same file again`;
}

export function toggleFileSelection(
  selected: readonly string[],
  id: string,
): string[] {
  return selected.includes(id)
    ? selected.filter((candidate) => candidate !== id)
    : [...selected, id];
}

export function discardConfirmation(name: string): string {
  return (
    `Discarding ${fileName(name)} throws away an upload that never finished. Nothing was ` +
    "stored, so there is nothing to restore — and the space it was holding comes back at once."
  );
}

export function storageFullMessage(
  usage: StorageUsage,
  neededBytes: number,
): string {
  return `This file needs ${formatBytes(neededBytes)} and only ${formatBytes(
    Math.max(0, usage.quota_bytes - usage.used_bytes),
  )} is free. ${DELETED_SPACE_RETURNS}`;
}

export interface FileTile {
  id: string;
  name: string;
  mime: string;
  kind: FileKind;
  sizeLabel: string;
  storedBytes: number;
  status: string;
  openable: boolean;
  readable: boolean;
  updatedAt: string;
}

export function fileCountLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function transferLabel(
  phase: UploadProgress["phase"],
  percent: number,
): string {
  return phase === "completing"
    ? "Finishing the upload…"
    : `Uploading… ${percent}%`;
}

export function uploadPercent(doneBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((doneBytes / totalBytes) * 100));
}

const FILE_KIND_LABELS: Record<FileKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF document",
  archive: "Archive",
  document: "Document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  code: "Code",
  text: "Text",
  other: "File",
};

export const UNKNOWN_FILE_TYPE = "Unknown type";

export function fileTypeLabel(
  kind: FileKind,
  name: string,
  readable: boolean,
): string {
  if (!readable) {
    return UNKNOWN_FILE_TYPE;
  }
  const extension = fileExtension(name);
  const label = FILE_KIND_LABELS[kind];
  return extension === "" || kind === "pdf" ? label : `${label} · ${extension}`;
}

export function exactBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return formatBytes(bytes);
  }
  const whole = Math.round(bytes);
  const exact = `${whole.toLocaleString("en-US")} ${whole === 1 ? "byte" : "bytes"}`;
  return whole < 1024 ? exact : `${formatBytes(whole)} (${exact})`;
}

export interface FolderContents {
  items: number;
  folders: number;
  bytes: number;
}

export function folderContents(
  fileBytes: readonly number[],
  folders: number,
): FolderContents {
  return {
    items: fileBytes.length,
    folders,
    bytes: fileBytes.reduce((total, bytes) => total + Math.max(0, bytes), 0),
  };
}

export function folderItemsLabel(
  contents: Pick<FolderContents, "items" | "folders">,
  nouns: FolderNouns = FILE_NOUNS,
): string {
  const items = countOf(contents.items, nouns);
  if (contents.folders === 0) {
    return items;
  }
  return `${items}, ${contents.folders === 1 ? "1 folder" : `${contents.folders} folders`}`;
}

export const FILE_NAME_LIMIT = 255;

export const FILE_NAME_PROBLEMS = {
  empty: "A file needs a name.",
  tooLong: `A file name is at most ${FILE_NAME_LIMIT} characters.`,
  separator: "A file name cannot contain / or \\.",
  control:
    "A file name cannot contain line breaks or other control characters.",
} as const;

export function fileNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") {
    return FILE_NAME_PROBLEMS.empty;
  }
  if (Array.from(trimmed).length > FILE_NAME_LIMIT) {
    return FILE_NAME_PROBLEMS.tooLong;
  }
  if (/[/\\]/.test(trimmed)) {
    return FILE_NAME_PROBLEMS.separator;
  }
  if (/\p{Cc}/u.test(trimmed)) {
    return FILE_NAME_PROBLEMS.control;
  }
  return undefined;
}

export function extensionChangeNote(
  before: string,
  after: string,
): string | undefined {
  const was = fileExtension(before);
  const now = fileExtension(after.trim());
  if (was === "" || was === now) {
    return undefined;
  }
  return `The file stays a ${was} file. Changing the name does not convert it.`;
}
