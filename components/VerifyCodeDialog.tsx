'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onSubmit: (code: string) => Promise<{ ok: boolean; reason?: string }>;
  ctaLabel: string;
  ctaColor?: string;
}

const ERROR_LABELS: Record<string, string> = {
  WRONG_CODE: 'Codice errato. Chiedi al negoziante/cliente di mostrartelo di nuovo.',
  WRONG_STATUS: 'Non è il momento giusto per verificare questo codice.',
  NOT_ASSIGNED_OR_WRONG_STATUS: 'Questo ordine non è più assegnato a te.',
  ORDER_NOT_FOUND: 'Ordine non trovato.',
};

const VerifyCodeDialog = ({
  open, title, description, onClose, onSubmit, ctaLabel,
  ctaColor = 'bg-olive-600 hover:bg-olive-700',
}: Props) => {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setError(null);
      // Focus su iOS richiede un piccolo delay
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim();
    if (cleaned.length !== 6) {
      setError('Il codice deve essere di 6 cifre');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(cleaned);
      if (!result.ok) {
        setError(ERROR_LABELS[result.reason ?? ''] ?? 'Verifica fallita');
      }
    } catch (err: any) {
      setError(err.message ?? 'Errore');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-xl font-extrabold text-ink-900">{title}</h2>
          <p className="text-sm text-ink-500 mt-1">{description}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="000000"
            className="w-full text-center font-mono text-4xl tracking-[0.5em] font-bold border-2 border-cream-300 rounded-xl py-4 focus:outline-none focus:border-indigo-500"
            autoComplete="one-time-code"
          />
          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2 text-center">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-cream-100 hover:bg-cream-200 text-ink-700 py-3 rounded-lg font-semibold"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={submitting || code.length !== 6}
              className={`flex-1 ${ctaColor} disabled:opacity-50 text-white py-3 rounded-lg font-bold`}
            >
              {submitting ? 'Verifica…' : ctaLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default VerifyCodeDialog;
