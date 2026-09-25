'use client';

import { useId, useState } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  maskedInputClass,
  pinInputAttributes,
  PRIVATE_TEXT_PROPS,
  secretInputAttributes,
  SECRET_FIELD_COPY,
  supportsTextSecurity,
} from '@/lib/app';
import { PIN_LENGTH } from '@/lib/pin';
import { IconButton } from './Button';
import { EyeIcon, EyeOffIcon } from './icons';

const INPUT_CLASS =
  'mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-all placeholder:text-ink-faint focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-raised disabled:text-ink-muted';

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

export function PinField({
  label,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'maxLength' | 'autoComplete' | 'className'
> & {
  label: string;
}) {
  const [cssMasking] = useState(() => supportsTextSecurity());

  return <Field label={label} {...pinInputAttributes(PIN_LENGTH, cssMasking)} {...props} />;
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
          {revealed ? <EyeOffIcon className="h-4 w-4 shrink-0" /> : <EyeIcon className="h-4 w-4 shrink-0" />}
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
