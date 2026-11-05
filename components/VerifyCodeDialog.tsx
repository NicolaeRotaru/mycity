'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';

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
  WRONG_STATUS: 'Ordine non nello stato giusto: potrebbe essere già stato confermato. Ricarica la pagina.',
  NOT_ASSIGNED_OR_WRONG_STATUS: 'Questo ordine non è più assegnato a te.',
  ORDER_NOT_FOUND: 'Ordine non trovato.',
  // S10 (5/11/2026) — Le funzioni del database rispondono anche così: prima il
  // fattorino leggeva solo «Verifica fallita» e riprovava a vuoto.
  LOCKED: 'Troppi tentativi sbagliati: la verifica è bloccata per 15 minuti. Riprova più tardi o scrivi all’assistenza.',
  CODE_NOT_ISSUED: 'Il codice per questo ordine non è stato generato: chiama l’assistenza.',
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // 140 / 151 — Prima era un `div` col velo nero e un Esc ascoltato solo sul
    // riquadro. S10 (5/11/2026, 657) — Adesso sta sopra la finestra comune
    // (components/ui/Modal), che trattiene il fuoco, chiude con Esc ovunque sia
    // il fuoco e lo riporta al pulsante che l'ha aperta.
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* 140 — Il campo aveva solo il segnaposto «000000»: nessun nome. */}
        <label htmlFor="verify-code" className="sr-only">Codice a 6 cifre</label>
        <input
          id="verify-code"
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
          aria-invalid={error ? true : undefined}
          className="w-full text-center font-mono text-4xl tracking-[0.5em] font-bold border-2 border-cream-300 rounded-xl py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus:border-primary-700"
          autoComplete="one-time-code"
        />
        {error && (
          <p role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded p-2 text-center">
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
    </Modal>
  );
};

export default VerifyCodeDialog;
