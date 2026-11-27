'use client';

import { useState } from 'react';

/** «Paga» dal link, per chi ha accettato ma non ha chiuso il pagamento (app/api/preventivo/[codice]/paga). */
export default function PagaDalLink({ codice }: { codice: string }) {
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  async function paga() {
    setErrore(null);
    setInvio(true);
    try {
      const r = await fetch(`/api/preventivo/${codice}/paga`, { method: 'POST' });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { url?: string }; error?: { message?: string } } | null;
      if (r.ok && corpo?.ok && corpo.data?.url) {
        window.location.assign(corpo.data.url);
        return;
      }
      setErrore(corpo?.error?.message ?? 'Non sono riuscito ad aprire il pagamento. Riprova fra un momento.');
    } catch {
      setErrore('Non sono riuscito ad aprire il pagamento. Controlla la connessione e riprova.');
    } finally {
      setInvio(false);
    }
  }
  return (
    <div className="mt-3">
      {errore && <p role="alert" className="mb-2 text-sm text-secondary-700">{errore}</p>}
      <button type="button" onClick={paga} disabled={invio} className="w-full rounded-lg bg-ink-900 py-3 font-bold text-white hover:bg-ink-800 disabled:opacity-60">
        {invio ? 'Un momento…' : 'Paga l’abbonamento'}
      </button>
    </div>
  );
}
