import type { AuthedContext } from '@/lib/context';
import { openBlob, sealBlob } from '@/lib/sealed';
import type { DekScope } from '@/lib/scopes';
import { refreshKeyrings } from './api';

export interface WrappedDek {
  wrapped_dek: string;
  key_generation: number;
}

export interface DekWrapper {
  wrapDek(dek: Uint8Array): Promise<WrappedDek>;
  unwrapDek(record: WrappedDek): Promise<Uint8Array>;
}

export function scopeDekWrapper(context: AuthedContext, scope: DekScope): DekWrapper {
  const { session } = context;
  return {
    async wrapDek(dek) {
      const { generation, kek } = session.currentKek(scope);
      return { wrapped_dek: await sealBlob(dek, kek), key_generation: generation };
    },
    async unwrapDek(record) {
      if (!session.hasKek(scope, record.key_generation)) {
        await refreshKeyrings(context);
      }
      return openBlob(record.wrapped_dek, session.kek(scope, record.key_generation));
    },
  };
}
