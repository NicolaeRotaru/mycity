'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ABBONAMENTI, FASCE, canonePrimoMese, scriviCanone, type Abbonamento } from '@/lib/agenzia/preventivo';

/**
 * Il titolare sceglie l'abbonamento, lascia l'email e accetta: il server gli crea l'accesso e apre
 * il pagamento (app/api/preventivo/[codice]/accetta). Se il pagamento non si apre, l'accettazione
 * vale lo stesso: entra dal link nell'email e paga dalla sua pagina.
 */
export default function AccettaDalLink({
  codice,
  consigliato,
  prezzi,
  primoMeseScontato,
}: {
  codice: string;
  consigliato: Abbonamento;
  prezzi: Record<Abbonamento, number | null>;
  primoMeseScontato: boolean;
}) {
  const [fascia, setFascia] = useState<Abbonamento>(consigliato);
  const [email, setEmail] = useState('');
  const [condizioni, setCondizioni] = useState(false);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState<null | { accessoInviato: boolean }>(null);

  async function accetta(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (!condizioni) {
      setErrore('Per continuare accetta le condizioni e l’informativa privacy.');
      return;
    }
    setInvio(true);
    try {
      const r = await fetch(`/api/preventivo/${codice}/accetta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, abbonamento: fascia, accettoCondizioni: true }),
      });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: { url?: string | null; accessoInviato?: boolean }; error?: { message?: string } } | null;
      if (!r.ok || !corpo?.ok) {
        setErrore(corpo?.error?.message ?? 'Non sono riuscito a inviare. Riprova fra un momento.');
        return;
      }
      if (corpo.data?.url) {
        window.location.assign(corpo.data.url);
        return;
      }
      setFatto({ accessoInviato: corpo.data?.accessoInviato === true });
    } catch {
      setErrore('Non sono riuscito a inviare. Controlla la connessione e riprova.');
    } finally {
      setInvio(false);
    }
  }

  if (fatto) {
    return (
      <div role="status" className="mt-6 rounded-2xl border-2 border-olive-300 bg-olive-50 p-5">
        <p className="font-semibold text-ink-900">Fatto, grazie!</p>
        <p className="mt-1 text-sm text-ink-700">
          {fatto.accessoInviato
            ? `Ti abbiamo scritto a ${email}: da lì entri nel tuo account.`
            : 'L’email con il link per entrare non è partita: ti scriviamo noi a breve.'}{' '}
          L’abbonamento lo paghi riaprendo questo stesso link.
        </p>
      </div>
    );
  }

  const prezzo = prezzi[fascia];
  return (
    <form onSubmit={accetta} className="mt-6 rounded-2xl border-2 border-cream-300 bg-surface-0 p-5" aria-labelledby="accetta-titolo">
      <h2 id="accetta-titolo" className="text-lg font-bold text-ink-900">Accetta e attiva</h2>
      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-ink-800">Quale abbonamento?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ABBONAMENTI.map((f) => (
            <label key={f} className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-sm ${fascia === f ? 'border-primary-600 bg-primary-50' : 'border-cream-200'}`}>
              <input type="radio" name="fascia" value={f} checked={fascia === f} onChange={() => setFascia(f)} className="sr-only" />
              {FASCE[f].nome} · {scriviCanone(prezzi[f])}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block text-sm font-medium text-ink-800" htmlFor="email-titolare">La tua email</label>
      <input
        id="email-titolare"
        type="email"
        required
        autoComplete="email"
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2"
      />
      <p className="mt-1 text-xs text-ink-500">Ti mandiamo qui il link per entrare nella pagina del tuo negozio.</p>
      <label className="mt-4 flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={condizioni} onChange={(e) => setCondizioni(e.target.checked)} className="mt-1" />
        <span>
          Accetto le <Link href="/terms" className="underline" target="_blank">condizioni</Link> e ho letto l’<Link href="/privacy" className="underline" target="_blank">informativa privacy</Link>.
        </span>
      </label>
      {errore && <p role="alert" className="mt-3 text-sm text-secondary-700">{errore}</p>}
      <button
        type="submit"
        disabled={invio}
        className="mt-4 w-full rounded-lg bg-ink-900 py-3 font-bold text-white hover:bg-ink-800 disabled:opacity-60"
      >
        {invio ? 'Un momento…' : prezzo ? `Accetto e pago ${scriviCanone(primoMeseScontato ? canonePrimoMese(prezzo) : prezzo)}` : 'Accetto'}
      </button>
    </form>
  );
}
