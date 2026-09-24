# `lib/pin` — the PIN format rules

The rules of [two-factor-PIN.md § PIN Format Rules](../../../../api-general/docs/auth/two-factor-PIN.md#pin-format-rules),
enforced before any PIN is registered:

- exactly 6 ASCII digits;
- not an ascending or descending run (`123456`, `654321`);
- not one repeated digit (`111111`).

```ts
validatePin(pin); // { valid: true } | { valid: false, reason }
assertValidPin(pin); // throws on the same rules
```

`lib/app/onboarding.ts` turns each `reason` into its sentence.

How a PIN is checked is [`lib/oprf`](../oprf/README.md): it never leaves the device, and the
server rations every guess. What it protects is [`lib/device`](../device/README.md).
