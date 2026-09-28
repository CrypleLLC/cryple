'use client';

import { useEffect, useRef, useState } from 'react';
import { CLIPBOARD_COPIED_LABEL, createSensitiveClipboard, type SensitiveClipboard } from '@/lib/app';
import { Button, HintedIconButton, type HintPlacement } from './Button';
import { CheckIcon, ClipboardIcon } from './icons';

let secretClipboard: SensitiveClipboard | undefined;

function clipboardForSecrets(): SensitiveClipboard | undefined {
  if (typeof window === 'undefined' || navigator.clipboard === undefined) {
    return undefined;
  }
  secretClipboard ??= createSensitiveClipboard({ clipboard: navigator.clipboard, focus: window });
  return secretClipboard;
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = CLIPBOARD_COPIED_LABEL,
  disabled = false,
  className = '',
  iconOnly = false,
  hintPlacement,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
  hintPlacement?: HintPlacement;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    void clipboardForSecrets()
      ?.copy(value)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };
  const glyph = copied ? <CheckIcon className="h-4 w-4 shrink-0 text-success" /> : <ClipboardIcon />;

  if (iconOnly) {
    return (
      <HintedIconButton
        hint={copied ? copiedLabel : label}
        placement={hintPlacement}
        disabled={disabled}
        className={className}
        onClick={copy}
      >
        {glyph}
      </HintedIconButton>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      title={label}
      aria-label={copied ? copiedLabel : label}
      className={className}
      onClick={copy}
    >
      {glyph}
      <span>{copied ? copiedLabel : label}</span>
    </Button>
  );
}
