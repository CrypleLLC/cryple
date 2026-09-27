'use client';

import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  backspaceInPin,
  maskedInputClass,
  pinBoxLabel,
  pinCompleted,
  pinDigitAttributes,
  pinDigits,
  type PinEntry,
  PRIVATE_TEXT_PROPS,
  reachablePinBox,
  secretInputAttributes,
  SECRET_FIELD_COPY,
  stepPinFocus,
  supportsTextSecurity,
  typeIntoPin,
} from '@/lib/app';
import { PIN_LENGTH } from '@/lib/pin';
import { IconButton } from './Button';
import { EyeIcon, EyeOffIcon } from './icons';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-all placeholder:text-ink-faint focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-raised disabled:text-ink-muted';

const PIN_BOX_CLASS =
  'h-12 w-11 min-w-0 shrink rounded-lg border border-line bg-surface text-center text-lg font-semibold text-ink outline-none transition-all focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-raised disabled:text-ink-muted';

const LABEL_CLASS = 'text-compact font-semibold text-ink-soft';

const HINT_CLASS = 'mt-1.5 block text-compact text-ink-muted';

export function Field({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <input
        className={maskedInputClass(INPUT_CLASS, className)}
        {...PRIVATE_TEXT_PROPS}
        {...props}
      />
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}

export interface PinFieldHandle {
  focus(): void;
}

export function PinField({
  ref,
  label,
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
}: {
  ref?: Ref<PinFieldHandle>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [cssMasking] = useState(() => supportsTextSecurity());
  const labelId = useId();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const latest = useRef(value);
  latest.current = value;
  const attributes = pinDigitAttributes(cssMasking);

  function focusBox(index: number) {
    const box = boxes.current[index];
    box?.focus();
    box?.select();
  }

  useImperativeHandle(ref, () => ({
    focus: () => focusBox(reachablePinBox(latest.current, PIN_LENGTH, PIN_LENGTH)),
  }));

  function enter(entry: PinEntry, from: number) {
    const previous = latest.current;
    latest.current = entry.value;
    onChange(entry.value);
    if (entry.focus !== from) {
      focusBox(entry.focus);
    }
    if (pinCompleted(previous, entry.value, PIN_LENGTH)) {
      onComplete?.(entry.value);
    }
  }

  return (
    <div>
      <span id={labelId} className={`block text-center ${LABEL_CLASS}`}>
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="mt-1.5 flex justify-center gap-2">
        {pinDigits(value, PIN_LENGTH).map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            {...PRIVATE_TEXT_PROPS}
            {...attributes}
            aria-label={pinBoxLabel(label, index, PIN_LENGTH)}
            autoFocus={autoFocus && index === 0}
            disabled={disabled}
            value={digit}
            className={maskedInputClass(PIN_BOX_CLASS, attributes.className)}
            onFocus={(event) => {
              const reachable = reachablePinBox(latest.current, index, PIN_LENGTH);
              if (reachable !== index) {
                focusBox(reachable);
                return;
              }
              event.target.select();
            }}
            onChange={(event) =>
              enter(typeIntoPin(latest.current, index, event.target.value, PIN_LENGTH), index)
            }
            onKeyDown={(event) => {
              if (event.key === 'Backspace') {
                const entry = backspaceInPin(latest.current, index, PIN_LENGTH);
                if (entry !== undefined) {
                  event.preventDefault();
                  enter(entry, index);
                }
                return;
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                focusBox(
                  stepPinFocus(
                    latest.current,
                    index,
                    event.key === 'ArrowLeft' ? -1 : 1,
                    PIN_LENGTH,
                  ),
                );
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function TextArea({
  label,
  hint,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <textarea
        className={maskedInputClass(INPUT_CLASS, 'h-28 resize-y font-mono', className)}
        {...PRIVATE_TEXT_PROPS}
        {...props}
      />
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}

export function SecretField({
  label,
  value,
  onChange,
  revealed,
  onRevealedChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  revealed: boolean;
  onRevealedChange: (revealed: boolean) => void;
  disabled?: boolean;
}) {
  const [cssMasking] = useState(() => supportsTextSecurity());
  const inputId = useId();
  const attributes = secretInputAttributes(!revealed, cssMasking);

  return (
    <div>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          {...PRIVATE_TEXT_PROPS}
          {...attributes}
          className={maskedInputClass(INPUT_CLASS, 'pr-11', attributes.className)}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <IconButton
          label={revealed ? SECRET_FIELD_COPY.hide : SECRET_FIELD_COPY.show}
          aria-pressed={revealed}
          aria-controls={inputId}
          disabled={disabled}
          onClick={() => onRevealedChange(!revealed)}
          className="absolute right-0.5 top-[calc(50%+0.1875rem)] -translate-y-1/2"
        >
          {revealed ? (
            <EyeOffIcon className="h-4 w-4 shrink-0" />
          ) : (
            <EyeIcon className="h-4 w-4 shrink-0" />
          )}
        </IconButton>
      </div>
    </div>
  );
}

export interface SelectChoice {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select({
  label,
  hint,
  choices,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  choices: readonly SelectChoice[];
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <select className={INPUT_CLASS} {...props}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.disabled}>
            {choice.label}
          </option>
        ))}
      </select>
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </label>
  );
}
