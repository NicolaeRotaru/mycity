'use client';

import type { AttributeField } from '@/lib/category-attributes';

interface Props {
  fields: AttributeField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  categoryLabel?: string;
}

const AttributesFields = ({ fields, values, onChange, categoryLabel }: Props) => {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-ink-500 italic">
        Seleziona una categoria per vedere le caratteristiche specifiche del prodotto.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold text-ink-800">
          Caratteristiche{categoryLabel ? ` · ${categoryLabel}` : ''}
        </h3>
        <span className="text-xs text-ink-500">Tutti i campi sono opzionali</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => {
          const value = values[f.key];
          const id = `attr-${f.key}`;
          const labelEl = (
            <label htmlFor={id} className="block text-sm font-medium text-ink-700 mb-1">
              {f.label}
              {f.unit && <span className="text-ink-400 ml-1">({f.unit})</span>}
            </label>
          );
          const helpEl = f.helpText && (
            <p className="text-xs text-ink-400 mt-1">{f.helpText}</p>
          );

          if (f.type === 'text') {
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  id={id}
                  type="text"
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                {helpEl}
              </div>
            );
          }
          if (f.type === 'textarea') {
            return (
              <div key={f.key} className="sm:col-span-2">
                {labelEl}
                <textarea
                  id={id}
                  rows={2}
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                {helpEl}
              </div>
            );
          }
          if (f.type === 'number') {
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  id={id}
                  type="number"
                  value={(value as number | string) ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
                  placeholder={f.placeholder}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                {helpEl}
              </div>
            );
          }
          if (f.type === 'select') {
            return (
              <div key={f.key}>
                {labelEl}
                <select
                  id={id}
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value || undefined)}
                  className="w-full border p-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  <option value="">—</option>
                  {f.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                {helpEl}
              </div>
            );
          }
          if (f.type === 'checkbox') {
            return (
              <div key={f.key} className="flex items-center gap-2 pt-6">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                  className="w-4 h-4 text-primary-700 rounded focus:ring-primary-400"
                />
                <label htmlFor={id} className="text-sm text-ink-700">{f.label}</label>
              </div>
            );
          }
          if (f.type === 'date') {
            return (
              <div key={f.key}>
                {labelEl}
                <input
                  id={id}
                  type="date"
                  value={(value as string) ?? ''}
                  onChange={(e) => onChange(f.key, e.target.value || undefined)}
                  className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
                {helpEl}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};

export default AttributesFields;
