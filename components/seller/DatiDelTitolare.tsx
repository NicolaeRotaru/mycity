'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { UserRound } from 'lucide-react';

/**
 * 25/11/2026 — «Dati del titolare» nel Profilo del negozio.
 *
 * Il modulo di iscrizione (/sell) adesso chiede solo il minimo per riconoscere
 * l'attività (Nicola: «lascia il minimo indispensabile»). Nome, cognome, codice
 * fiscale, data di nascita e residenza di chi firma si scrivono qui, dopo
 * l'approvazione. Salva la rotta del server (PATCH /api/seller/titolare), che
 * controlla anche la maggiore età. Restano privati: il cliente non li vede.
 */
export type DatiTitolare = {
  legalFirstName: string;
  legalLastName: string;
  legalFiscalCode: string;
  legalBirthDate: string;
  legalResidenceAddr: string;
  legalResidenceCity: string;
  legalResidenceZip: string;
};

const CAMPI: Array<{ k: keyof DatiTitolare; label: string; tipo?: string; largo?: boolean }> = [
  { k: 'legalFirstName', label: 'Nome' },
  { k: 'legalLastName', label: 'Cognome' },
  { k: 'legalFiscalCode', label: 'Codice fiscale' },
  { k: 'legalBirthDate', label: 'Data di nascita', tipo: 'date' },
  { k: 'legalResidenceAddr', label: 'Indirizzo di residenza', largo: true },
  { k: 'legalResidenceCity', label: 'Città di residenza' },
  { k: 'legalResidenceZip', label: 'CAP' },
];

export default function DatiDelTitolare({ iniziali, quandoSalvati }: { iniziali: DatiTitolare; quandoSalvati?: () => void }) {
  const [dati, setDati] = useState<DatiTitolare>(iniziali);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const salva = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    try {
      const r = await fetch('/api/seller/titolare', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dati),
      });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
        setErrore(corpo?.error?.message ?? corpo?.message ?? 'Non sono riuscito a salvare: riprova.');
        return;
      }
      toast.success('Dati del titolare salvati');
      quandoSalvati?.();
    } catch {
      setErrore('Non sono riuscito a salvare: controlla la connessione e riprova.');
    } finally {
      setInvio(false);
    }
  };

  return (
    <form id="titolare" onSubmit={salva} className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6 scroll-mt-24 md:scroll-mt-0">
      <h2 className="font-semibold text-ink-900 mb-1 flex items-center gap-2">
        <UserRound size={18} className="text-olive-600" aria-hidden /> Dati del titolare
      </h2>
      <p className="text-sm text-ink-500 mb-4">
        Chi firma per l&apos;attività. Servono per il contratto e restano privati: i clienti non li vedono.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPI.map(({ k, label, tipo, largo }) => (
          <label key={k} className={largo ? 'sm:col-span-2' : undefined}>
            <span className="block text-sm font-medium text-ink-800">{label}</span>
            <input
              name={k}
              type={tipo ?? 'text'}
              value={dati[k]}
              onChange={(ev) => setDati((d) => ({ ...d, [k]: ev.target.value }))}
              required
              autoComplete="off"
              className={`mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm${k === 'legalFiscalCode' ? ' uppercase font-mono' : ''}`}
            />
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
        {invio ? 'Salvo…' : 'Salva i dati del titolare'}
      </button>
    </form>
  );
}
