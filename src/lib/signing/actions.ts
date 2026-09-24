export type SignerRole = 'root' | 'device';

export interface ActionSpec {
  readonly args: readonly string[];
  readonly signer: SignerRole;
  readonly pinProof: boolean;
  readonly variadic?: boolean;
}

export const ACTIONS = {
  'chain-read': { args: ['user_address'], signer: 'root', pinProof: true },
  'device-enrol': { args: ['user_address', 'batch_digest'], signer: 'root', pinProof: true },
  'account-delete': { args: ['user_address'], signer: 'root', pinProof: true },
  'second-factor-begin': {
    args: ['user_address', 'blinded_element'],
    signer: 'root',
    pinProof: true,
  },
  'enable-second-factor': { args: ['proof_public_key'], signer: 'root', pinProof: false },
  'rotate-second-factor': { args: ['proof_public_key'], signer: 'root', pinProof: true },
  'pin-evaluate': { args: ['user_address', 'blinded_element'], signer: 'root', pinProof: false },
  'username-update': { args: ['username'], signer: 'device', pinProof: false },
  'secret-delete': { args: ['secret_id'], signer: 'device', pinProof: false, variadic: true },
  'note-delete': { args: ['note_id'], signer: 'device', pinProof: false, variadic: true },
  'document-delete': {
    args: ['document_id'],
    signer: 'device',
    pinProof: false,
    variadic: true,
  },
  'file-delete': { args: ['file_id'], signer: 'device', pinProof: false, variadic: true },
  'secret-rekey': { args: ['secret_id'], signer: 'device', pinProof: false, variadic: true },
  'note-rekey': { args: ['note_id'], signer: 'device', pinProof: false, variadic: true },
  'document-rekey': {
    args: ['document_id'],
    signer: 'device',
    pinProof: false,
    variadic: true,
  },
  'file-rekey': { args: ['file_id'], signer: 'device', pinProof: false, variadic: true },
  'credential-delete': {
    args: ['credential_id'],
    signer: 'device',
    pinProof: false,
    variadic: true,
  },
  'credential-prune': {
    args: ['credential_id', 'keep_last'],
    signer: 'device',
    pinProof: false,
  },
  'credential-rekey': {
    args: ['revision_id'],
    signer: 'device',
    pinProof: false,
    variadic: true,
  },
  'connection-invite': {
    args: ['recipient_username', 'pqxdh_blob', 'sender_key_generation', 'recipient_key_generation'],
    signer: 'device',
    pinProof: false,
  },
  'connection-accept': { args: ['connection_id'], signer: 'device', pinProof: false },
  'connection-delete': { args: ['connection_id'], signer: 'device', pinProof: false },
  'connection-keys': { args: ['connection_id', 'keys_digest'], signer: 'device', pinProof: false },
  'connection-reestablish': {
    args: ['connection_id', 'pqxdh_blob', 'sender_key_generation', 'recipient_key_generation'],
    signer: 'device',
    pinProof: false,
  },
  'share-create': {
    args: ['connection_id', 'item_type', 'item_id'],
    signer: 'device',
    pinProof: false,
  },
  'share-delete': { args: ['share_id'], signer: 'device', pinProof: false },
  'address-book-update': {
    args: ['expected_revision', 'ciphertext_digest'],
    signer: 'device',
    pinProof: false,
  },
} as const satisfies Record<string, ActionSpec>;

export type ActionLabel = keyof typeof ACTIONS;

export type RootActionLabel = {
  [K in ActionLabel]: (typeof ACTIONS)[K]['signer'] extends 'root' ? K : never;
}[ActionLabel];

export type DeviceActionLabel = Exclude<ActionLabel, RootActionLabel>;

export function getActionSpec(action: ActionLabel): ActionSpec {
  const spec = ACTIONS[action];
  if (spec === undefined) {
    throw new Error(`unknown action label: ${action}`);
  }
  return spec;
}

export function normalizeActionArgs(
  action: ActionLabel,
  args: readonly (string | number)[],
): string[] {
  const spec = getActionSpec(action);
  const values = args.map(String);

  for (const value of values) {
    if (value.length === 0) {
      throw new Error(`${action}: arguments must not be empty`);
    }
    if (value.includes(':')) {
      throw new Error(`${action}: arguments must not contain ":" — it is the field separator`);
    }
  }

  if (spec.variadic) {
    if (values.length === 0) {
      throw new Error(`${action}: needs at least one ${spec.args[0]}`);
    }
    return [...new Set(values)].sort();
  }

  if (values.length !== spec.args.length) {
    throw new Error(
      `${action}: expected ${spec.args.length} argument(s) (${spec.args.join(', ')}), got ${values.length}`,
    );
  }

  return values;
}
