export const DEFAULT_SEAL_BUFFER_BYTES = 128 << 20;

export class SealBufferExceededError extends Error {
  readonly storedBytes: number;
  readonly limitBytes: number;

  constructor(storedBytes: number, limitBytes: number) {
    super(
      `this file needs ${storedBytes} bytes of sealed buffer and the limit is ${limitBytes}. ` +
        'The whole object has to be sealed before the upload can be authorised, so it has to be ' +
        'held somewhere first.',
    );
    this.name = 'SealBufferExceededError';
    this.storedBytes = storedBytes;
    this.limitBytes = limitBytes;
  }
}

export interface SealedSink {
  reserve(storedBytes: number, chunkCount: number): Promise<void>;
  write(index: number, chunk: Uint8Array): Promise<void>;
  read(index: number): Promise<Uint8Array>;
  release(): void;
}

export function memorySink(limitBytes: number = DEFAULT_SEAL_BUFFER_BYTES): SealedSink {
  let chunks: (Uint8Array | undefined)[] = [];

  return {
    async reserve(storedBytes: number, chunkCount: number) {
      if (storedBytes > limitBytes) {
        throw new SealBufferExceededError(storedBytes, limitBytes);
      }
      chunks = new Array<Uint8Array | undefined>(chunkCount);
    },

    async write(index: number, chunk: Uint8Array) {
      chunks[index] = chunk;
    },

    async read(index: number) {
      const chunk = chunks[index];
      if (chunk === undefined) {
        throw new Error(`sealed chunk ${index} is no longer held — the upload cannot be resumed`);
      }
      return chunk;
    },

    release() {
      chunks = [];
    },
  };
}
