export type SignerRole = 'owner' | 'guardian' | 'invitee';

export interface ActionSpec {
  readonly args: readonly string[];
  readonly secondFactor: boolean;
  readonly signer: SignerRole;
  readonly variadic?: boolean;
}

export const ACTIONS = {
  'pin-reset-request': { args: ['user_address'], secondFactor: false, signer: 'owner' },
  'pin-reset-vote': { args: ['request_id'], secondFactor: true, signer: 'guardian' },
  'pin-reset-revoke': { args: ['request_id'], secondFactor: false, signer: 'owner' },
  'pin-reset-confirm': {
    args: ['request_id', 'new_server_auth_token'],
    secondFactor: false,
    signer: 'owner',
  },
  'guardian-invite': {
    args: ['guardian_username'],
    secondFactor: true,
    signer: 'owner',
  },
  'guardian-accept': { args: ['invitation_id'], secondFactor: true, signer: 'invitee' },
  'guardian-revoke': { args: ['guardian_id'], secondFactor: true, signer: 'owner' },
  'recovery-setup': { args: ['setup_digest'], secondFactor: true, signer: 'owner' },
  'recovery-share-submit': {
    args: ['session_id', 're_encrypted_share'],
    secondFactor: true,
    signer: 'guardian',
  },
  'enable-second-factor': {
    args: ['new_server_auth_token'],
    secondFactor: false,
    signer: 'owner',
  },
  'rotate-second-factor': {
    args: ['new_server_auth_token'],
    secondFactor: true,
    signer: 'owner',
  },
  'account-delete': { args: ['user_address'], secondFactor: true, signer: 'owner' },
  'secret-delete': {
    args: ['secret_id'],
    secondFactor: true,
    signer: 'owner',
    variadic: true,
  },
  'note-delete': {
    args: ['note_id'],
    secondFactor: true,
    signer: 'owner',
    variadic: true,
  },
  'beneficiary-register': {
    args: ['beneficiary_username'],
    secondFactor: true,
    signer: 'owner',
  },
  'beneficiary-delete': {
    args: ['beneficiary_id'],
    secondFactor: true,
    signer: 'owner',
  },
  'share-assign': {
    args: ['beneficiary_id', 'item_id'],
    secondFactor: true,
    signer: 'owner',
  },
  'share-delete': { args: ['share_id'], secondFactor: true, signer: 'owner' },
  'succession-release-vote': {
    args: ['owner_user_address', 'release_cycle'],
    secondFactor: true,
    signer: 'guardian',
  },
} as const satisfies Record<string, ActionSpec>;

export type ActionLabel = keyof typeof ACTIONS;

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
