'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';

/**
 * «Segnala»: il modo per dirci che un contenuto è illecito.
 *
 * 22/8/2026 — NON C'ERA. Sul sito non esisteva nessun canale per segnalare un
 * prodotto contraffatto, pericoloso o illecito. Il regolamento europeo sui
 * servizi digitali lo chiede a ogni piattaforma che ospita contenuti di terzi,
 * e per un marketplace è anche la difesa più economica che esista: chi vede una
 * cosa sbagliata ce la dice prima che la compri qualcun altro.
 *
 * Si può segnalare senza account. Chi lascia un recapito riceve un esito
 * motivato: è l'altra metà dell'obbligo, e la parte che si dimentica sempre.
 */
const MOTIVI: Array<{ valore: string; etichetta: string }> = [
  { valore: 'contraffatto', etichetta: 'Prodotto contraffatto' },
  { valore: 'pericoloso', etichetta: 'Prodotto pericoloso o non conforme' },
  { valore: 'ingannevole', etichetta: 'Descrizione o prezzo ingannevoli' },
  { valore: 'proprieta_intellettuale', etichetta: 'Uso non autorizzato di un marchio o di foto' },
  { valore: 'odio_o_molestie', etichetta: 'Contenuto offensivo o molesto' },
  { valore: 'illecito', etichetta: 'Altro contenuto illecito' },
  { valore: 'altro', etichetta: 'Altro' },
];

export function Segnala({
  tipo,
  oggettoId,
}: {
  tipo: 'prodotto' | 'negozio' | 'recensione' | 'messaggio';
  oggettoId: string;
}) {
  const [aperto, setAperto] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVI[0].valore);
  const [dettaglio, setDettaglio] = useState('');
  const [email, setEmail] = useState('');
  const [inCorso, setInCorso] = useState(false);

  const invia = async () => {
    setInCorso(true);
    try {
      const res = await fetch('/api/segnalazioni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          oggettoId,
          motivo,
          dettaglio: dettaglio.trim() || undefined,
          emailContatto: email.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Segnalazione non inviata');
      toast.success('Segnalazione ricevuta. La guardiamo e ti diciamo com è andata.');
      setAperto(false);
      setDettaglio('');
    } catch {
      toast.error('Non è stato possibile inviare la segnalazione. Riprova.');
    } finally {
      setInCorso(false);
    }
  };

  if (!aperto) {
    return (
      <button
        type="button"
        onClick={() => setAperto(true)}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
      >
        <Flag size={14} strokeWidth={2.2} aria-hidden /> Segnala questo contenuto
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="Segnala un contenuto" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="font-serif text-lg font-bold text-ink-900">Segnala un contenuto</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-600">
          Dicci che cosa non va. Guardiamo ogni segnalazione e, se lasci un recapito, ti scriviamo com
          è finita e perché.
        </p>

        <label htmlFor="segnala-motivo" className="mt-4 block text-sm font-medium text-ink-700">Motivo</label>
        <select
          id="segnala-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        >
          {MOTIVI.map((m) => (
            <option key={m.valore} value={m.valore}>{m.etichetta}</option>
          ))}
        </select>

        <label htmlFor="segnala-dettaglio" className="mt-3 block text-sm font-medium text-ink-700">
          Cosa hai visto (facoltativo)
        </label>
        <textarea
          id="segnala-dettaglio"
          value={dettaglio}
          onChange={(e) => setDettaglio(e.target.value)}
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        />

        <label htmlFor="segnala-email" className="mt-3 block text-sm font-medium text-ink-700">
          La tua email, se vuoi la risposta (facoltativa)
        </label>
        <input
          id="segnala-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-sm"
        />

        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" fullWidth onClick={() => setAperto(false)} disabled={inCorso}>
            Annulla
          </Button>
          <Button fullWidth onClick={invia} disabled={inCorso}>
            {inCorso ? 'Invio…' : 'Invia segnalazione'}
          </Button>
        </div>
      </div>
    </div>
  );
}
