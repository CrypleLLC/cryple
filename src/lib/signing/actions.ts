export type SignerRole = 'owner';

export interface ActionSpec {
  readonly args: readonly string[];
  readonly secondFactor: boolean;
  readonly signer: SignerRole;
  readonly variadic?: boolean;
}

export const ACTIONS = {
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
  'document-delete': {
    args: ['document_id'],
    secondFactor: true,
    signer: 'owner',
    variadic: true,
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
