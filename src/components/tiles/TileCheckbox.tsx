import { CheckIcon } from '@/components/ui/icons';

export function TileCheckbox({
  name,
  selected,
  selecting,
  disabled,
  onToggle,
  className,
}: {
  name: string;
  selected: boolean;
  selecting: boolean;
  disabled: boolean;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${name}`}
      disabled={disabled}
      onClick={onToggle}
      className={`absolute z-10 flex h-5 w-5 items-center justify-center rounded-md border shadow-card transition focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${className} ${
        selected
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-line-strong bg-surface/90 text-transparent hover:border-brand-400'
      } ${selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
    >
      <CheckIcon className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
