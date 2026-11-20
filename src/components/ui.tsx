import type { ReactNode } from 'react';

export function Seg<T extends string | number>({
  value, options, onChange, label,
}: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="seg">
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, hint, children, className = '' }: { title?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || hint) && (
        <header className="flex items-baseline justify-between gap-3 mb-3">
          {title && <h2 className="panel-title">{title}</h2>}
          {hint && <div className="text-[11px] text-[#7d7667]">{hint}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
