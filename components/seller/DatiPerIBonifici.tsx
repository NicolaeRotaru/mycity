'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Landmark } from 'lucide-react';

/**
 * R11-003 — «Dati per i bonifici» nel profilo del negozio già iscritto.
 * Prima IBAN e dati della ditta si scrivevano solo dal modulo d'iscrizione, che
 * a un negozio approvato non si apre più. Salva la rotta del server
 * (PATCH /api/seller/apply), con gli stessi controlli dell'iscrizione.
 */
export type DatiBonifici = {
  billingIban: string;
  businessLegalName: string;
  businessVatNumber: string;
  businessAddress: string;
  businessCity: string;
  businessZip: string;
  businessPec: string;
  businessSdi: string;
};

const CAMPI: Array<{ k: keyof DatiBonifici; label: string; aiuto?: string; facoltativo?: boolean }> = [
  { k: 'billingIban', label: 'IBAN', aiuto: 'Il conto su cui ricevi i bonifici di MyCity.' },
  { k: 'businessLegalName', label: 'Ragione sociale' },
  { k: 'businessVatNumber', label: 'Partita IVA' },
  { k: 'businessAddress', label: 'Sede legale (via)' },
  { k: 'businessCity', label: 'Città della sede' },
  { k: 'businessZip', label: 'CAP della sede' },
  { k: 'businessPec', label: 'PEC', facoltativo: true },
  { k: 'businessSdi', label: 'Codice SDI', facoltativo: true },
];

export default function DatiPerIBonifici({ iniziali, quandoSalvati }: { iniziali: DatiBonifici; quandoSalvati?: () => void }) {
  const [dati, setDati] = useState<DatiBonifici>(iniziali);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    try {
      const r = await fetch('/api/seller/apply', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dati),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
        setErrore(corpo?.error?.message ?? corpo?.message ?? 'Non sono riuscito a salvare: riprova.');
        return;
      }
      toast.success('Dati per i bonifici salvati');
      quandoSalvati?.();
    } catch {
      setErrore('Non sono riuscito a salvare: controlla la connessione e riprova.');
    } finally {
      setInvio(false);
    }
  };

  return (
    <form id="bonifici" onSubmit={salva} className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6 scroll-mt-24">
      <h2 className="font-semibold text-ink-900 mb-1 flex items-center gap-2">
        <Landmark size={18} className="text-olive-600" aria-hidden /> Dati per i bonifici
      </h2>
      <p className="text-sm text-ink-500 mb-4">
        IBAN e dati della ditta: servono per mandarti i soldi dei tuoi ordini e per la fattura.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPI.map(({ k, label, aiuto, facoltativo }) => (
          <label key={k} className={k === 'billingIban' ? 'sm:col-span-2' : undefined}>
            <span className="block text-sm font-medium text-ink-800">
              {label}
              {facoltativo && <span className="font-normal text-ink-500"> (facoltativo)</span>}
            </span>
            <input
              name={k}
              value={dati[k]}
              onChange={(ev) => setDati((d) => ({ ...d, [k]: ev.target.value }))}
              required={!facoltativo}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm font-mono"
            />
            {aiuto && <span className="mt-0.5 block text-xs text-ink-500">{aiuto}</span>}
          </label>
        ))}
      </div>
      {errore && (
        <p role="alert" className="mt-3 text-sm text-secondary-700">{errore}</p>
      )}
      <button
        type="submit"
        disabled={invio}
        className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {invio ? 'Salvo…' : 'Salva i dati per i bonifici'}
      </button>
    </form>
  );
}
