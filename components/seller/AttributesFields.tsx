'use client';

import { useState } from 'react';
import { Plus, X, Layers } from 'lucide-react';
import type { AttributeField } from '@/lib/category-attributes';

interface Props {
  fields: AttributeField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  categoryLabel?: string;
  /** Assi di variante attivi: chiave campo → valori (es. taglia → [S,M,L]). */
  variantAxes?: Record<string, string[]>;
  /** Attiva/disattiva un campo come asse di varianti. */
  onToggleVariant?: (key: string, on: boolean) => void;
  /** Aggiorna i valori di un asse di varianti. */
  onAxisValuesChange?: (key: string, values: string[]) => void;
}

const AttributesFields = ({
  fields,
  values,
  onChange,
  categoryLabel,
  variantAxes,
  onToggleVariant,
  onAxisValuesChange,
}: Props) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (fields.length === 0) {
    return (
      <p className="text-sm text-ink-500 italic">
        Seleziona una categoria per vedere le caratteristiche specifiche del prodotto.
      </p>
    );
  }

  const axisValues = (key: string): string[] => variantAxes?.[key] ?? [];
  const isAxis = (key: string): boolean => !!variantAxes && key in variantAxes;
  const canVary = (f: AttributeField): boolean => !!f.variantable && !!onToggleVariant;

  const addAxisValue = (key: string, raw: string) => {
    const v = raw.trim();
    setDrafts((d) => ({ ...d, [key]: '' }));
    if (!v || !onAxisValuesChange) return;
    const cur = axisValues(key);
    if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onAxisValuesChange(key, [...cur, v]);
  };
  const removeAxisValue = (key: string, val: string) =>
    onAxisValuesChange?.(key, axisValues(key).filter((x) => x !== val));

  // Editor di un asse di varianti (campo trasformato in più valori).
  const renderAxis = (f: AttributeField) => {
    const vals = axisValues(f.key);
    const remainingOptions = (f.options ?? []).filter((o) => !vals.includes(o));
    return (
      <div
        key={f.key}
        className="sm:col-span-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2"
      >
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-700">
            <Layers size={14} strokeWidth={2.2} aria-hidden /> {f.label} · varianti
          </span>
          <button
            type="button"
            onClick={() => onToggleVariant?.(f.key, false)}
            className="text-xs font-medium text-ink-500 hover:text-ink-800"
          >
            ↩ Valore singolo
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-cream-300 bg-white p-2">
          {vals.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-800"
            >
              {v}
              <button
                type="button"
                onClick={() => removeAxisValue(f.key, v)}
                aria-label={`Rimuovi ${v}`}
                className="text-primary-500 hover:text-primary-900"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={drafts[f.key] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addAxisValue(f.key, drafts[f.key] ?? '');
              }
            }}
            onBlur={() => addAxisValue(f.key, drafts[f.key] ?? '')}
            placeholder={vals.length === 0 ? `Aggiungi ${f.label.toLowerCase()} (es. S, M, L)…` : 'Aggiungi…'}
            className="min-w-[8rem] flex-1 border-0 p-1 text-sm focus:outline-none focus:ring-0"
          />
        </div>
        {remainingOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {remainingOptions.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onAxisValuesChange?.(f.key, [...vals, o])}
                className="inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white px-2 py-0.5 text-xs font-medium text-ink-600 hover:border-primary-300 hover:bg-primary-50"
              >
                <Plus size={11} strokeWidth={2.6} aria-hidden /> {o}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-400">Imposterai la disponibilità di ogni combinazione qui sotto.</p>
      </div>
    );
  };

  const renderInput = (f: AttributeField) => {
    const value = values[f.key];
    const id = `attr-${f.key}`;
    if (f.type === 'textarea') {
      return (
        <textarea
          id={id}
          rows={2}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(f.key, e.target.value)}
          placeholder={f.placeholder}
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      );
    }
    if (f.type === 'number') {
      return (
        <input
          id={id}
          type="number"
          value={(value as number | string) ?? ''}
          onChange={(e) => onChange(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder={f.placeholder}
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      );
    }
    if (f.type === 'select') {
      return (
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
      );
    }
    if (f.type === 'date') {
      return (
        <input
          id={id}
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(f.key, e.target.value || undefined)}
          className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      );
    }
    // text
    return (
      <input
        id={id}
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(f.key, e.target.value)}
        placeholder={f.placeholder}
        className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
      />
    );
  };

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
          // Campo trasformato in asse di varianti → editor multi-valore.
          if (isAxis(f.key)) return renderAxis(f);

          const id = `attr-${f.key}`;
          // Checkbox: layout inline dedicato.
          if (f.type === 'checkbox') {
            return (
              <div key={f.key} className="flex items-center gap-2 pt-6">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(values[f.key])}
                  onChange={(e) => onChange(f.key, e.target.checked)}
                  className="w-4 h-4 text-primary-700 rounded focus:ring-primary-400"
                />
                <label htmlFor={id} className="text-sm text-ink-700">{f.label}</label>
              </div>
            );
          }

          return (
            <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={id} className="block text-sm font-medium text-ink-700 mb-1">
                {f.label}
                {f.unit && <span className="text-ink-400 ml-1">({f.unit})</span>}
              </label>
              {renderInput(f)}
              {f.helpText && <p className="text-xs text-ink-400 mt-1">{f.helpText}</p>}
              {canVary(f) && (
                <button
                  type="button"
                  onClick={() => onToggleVariant?.(f.key, true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900"
                >
                  <Plus size={12} strokeWidth={2.6} aria-hidden /> Più {f.label.toLowerCase()} (varianti)
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttributesFields;
