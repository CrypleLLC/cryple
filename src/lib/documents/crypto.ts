import { openBlob, sealBlob } from '@/lib/sealed';
import { wrapper, type DocumentsContext } from './api';
import type { DocumentRecord } from './records';

export async function openDocumentDek(
  context: DocumentsContext,
  document: Pick<DocumentRecord, 'wrapped_dek'>,
): Promise<Uint8Array> {
  return wrapper(context).unwrapDek(document.wrapped_dek);
}

export async function sealUpdate(update: Uint8Array, dek: Uint8Array): Promise<string> {
  return sealBlob(update, dek);
}

export async function openUpdate(ciphertext: string, dek: Uint8Array): Promise<Uint8Array> {
  return openBlob(ciphertext, dek);
}
