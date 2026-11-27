'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { Abbonamento } from '@/lib/agenzia/preventivo';
import { FRASE_CONTANTI, PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';

/**
 * LE TRE FASCE, IL CODICE DELL'EMAIL E L'INGRESSO — 27/11/2026 (app/preventivo/[codice]/page.tsx).
 *
 * Nicola: il titolare vede i tre abbonamenti, trova segnato quello detto al venditore, può toccarne un
 * altro e confermare quello; dopo il clic entra nella sua pagina con l'abbonamento scelto. Sul rischio
 * trovato dal collaudo della sicurezza ha scelto «codice dall'email». Quindi due passi nella stessa pagina:
 *  1. fascia, email, condizioni → «Confermo il …»: parte il codice (app/api/preventivo/[codice]/codice);
 *  2. il titolare scrive il codice → «Entra nella mia pagina»: il server lo verifica, accetta e apre la
 *     sessione (…/accetta), e risponde con `entra`, la pagina dell'abbonamento del negozio. Fino a lì
 *     niente cambia sul negozio (secondo collaudo della sicurezza, 27/11).
 * Senza `entra` (un altro account già dentro in questo browser) entra dal link dell'email, come prima.
 * Il testo delle fasce lo prepara il server (`fasce`).
 */

export type FasciaDaConfermare = {
  id: Abbonamento;
  nome: string;
  canone: string;
  primoMese: string | null;
  perChi: string;
  servizi: { titolo: string; testo: string }[];
};

type Risposta = {
  ok?: boolean;
  data?: { url?: string | null; entra?: string | null; accessoInviato?: boolean; gettone?: string };
  error?: { message?: string };
};

export default function ConfermaAbbonamento({
  codice,
  fasce,
  iniziale,
  segnata,
  dalVenditore,
}: {
  codice: string;
  fasce: FasciaDaConfermare[];
  /** La fascia detta al venditore; senza, la consigliata. */
  iniziale: Abbonamento;
  /** La fascia con l'etichetta: quella detta al venditore, o la consigliata. */
  segnata: Abbonamento;
  /** Vero se `segnata` l'ha scelta il titolare davanti al venditore: l'etichetta dice «La tua scelta». */
  dalVenditore: boolean;
}) {
  const [fascia, setFascia] = useState<Abbonamento>(iniziale);
  const [email, setEmail] = useState('');
  const [condizioni, setCondizioni] = useState(false);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState<null | { accessoInviato: boolean }>(null);
  /** Il secondo passo: il codice è partito, si aspetta che il titolare lo scriva. */
  const [fase, setFase] = useState<'scelta' | 'codice'>('scelta');
  const [codiceEmail, setCodiceEmail] = useState('');
  /** Il gettone firmato che accompagna il codice (lib/agenzia/codice-dal-link.ts): il codice in chiaro non c'è. */
  const [gettone, setGettone] = useState('');
  const [rimandato, setRimandato] = useState(false);
  const scelta = fasce.find((f) => f.id === fascia) ?? fasce[0];

  async function chiedi(percorso: 'codice' | 'accetta', corpo: Record<string, unknown>): Promise<Risposta | null> {
    const r = await fetch(`/api/preventivo/${codice}/${percorso}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const letto = (await r.json().catch(() => null)) as Risposta | null;
    if (!r.ok || !letto?.ok) {
      setErrore(letto?.error?.message ?? 'Non ci sono riuscito. Riprova fra un momento.');
      return null;
    }
    return letto;
  }

  /** Passo 1, e «Rimanda il codice»: parte il codice all'email. */
  async function mandaCodice(nuovo: boolean) {
    setErrore(null);
    setInvio(true);
    try {
      const r = await chiedi('codice', { email, abbonamento: fascia });
      if (r) {
        setGettone(r.data?.gettone ?? '');
        setFase('codice');
        setRimandato(nuovo);
        setCodiceEmail('');
      }
    } catch {
      setErrore('Non ci sono riuscito. Controlla la connessione e riprova.');
    }
    setInvio(false);
  }

  async function conferma(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (!condizioni) {
      setErrore('Per continuare accetta le condizioni e l’informativa privacy.');
      return;
    }
    await mandaCodice(false);
  }

  /** Passo 2: il codice giusto accetta e apre la sessione. */
  async function entra(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInvio(true);
    try {
      const r = await chiedi('accetta', { email, abbonamento: fascia, accettoCondizioni: true, codice: codiceEmail, gettone });
      if (r) {
        const dove = r.data?.url ?? r.data?.entra ?? null;
        if (dove) {
          // Il pulsante resta su «Un momento…» finché la pagina nuova non si apre.
          window.location.assign(dove);
          return;
        }
        setFatto({ accessoInviato: r.data?.accessoInviato === true });
      }
    } catch {
      setErrore('Non ci sono riuscito. Controlla la connessione e riprova.');
    }
    setInvio(false);
  }

  if (fatto) {
    return (
      <div role="status" className="mt-6 rounded-2xl border-2 border-olive-300 bg-olive-50 p-5">
        <p className="font-semibold text-ink-900">Fatto, il {scelta.nome} è confermato.</p>
        <p className="mt-1 text-sm text-ink-700">
          {fatto.accessoInviato
            ? `Ti abbiamo scritto a ${email}: da lì entri nella tua pagina.`
            : 'L’email con il link per entrare non è partita: ti scriviamo noi a breve.'}
        </p>
      </div>
    );
  }

  if (fase === 'codice') {
    return (
      <form onSubmit={entra} className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-primary-200 bg-surface-0 p-5" aria-label="Scrivi il codice">
        <p className="text-sm text-ink-700">
          Hai scelto il <strong className="text-ink-900">{scelta.nome}</strong> · {scelta.canone}{' '}
          <button type="button" onClick={() => { setFase('scelta'); setErrore(null); }} className="font-semibold text-primary-700 underline">Cambia</button>
        </p>
        <h2 className="mt-3 text-lg font-bold text-ink-900">{rimandato ? 'Ti abbiamo mandato un codice nuovo' : 'Ti abbiamo mandato un codice'}</h2>
        <p className="mt-1 text-sm text-ink-700">
          È arrivato a <strong className="text-ink-900">{email}</strong>. Scrivilo qui per entrare nella tua pagina.
        </p>
        <label className="mt-4 block text-sm font-medium text-ink-800" htmlFor="codice-email">Il codice dell’email</label>
        <input
          id="codice-email"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={codiceEmail}
          onChange={(e) => setCodiceEmail(e.target.value.replace(/\D/g, ''))}
          className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-center text-2xl font-bold tracking-[0.4em]"
        />
        {errore && <p role="alert" className="mt-3 text-sm text-secondary-700">{errore}</p>}
        <button
          type="submit"
          disabled={invio || codiceEmail.length < 6}
          className="mt-4 w-full rounded-lg bg-primary-700 py-3 text-lg font-bold text-white hover:bg-primary-800 disabled:opacity-60"
        >
          {invio ? 'Un momento…' : 'Entra nella mia pagina'}
        </button>
        <p className="mt-3 text-center text-sm text-ink-600">
          Non è arrivato? Guarda anche nello spam, oppure{' '}
          <button type="button" disabled={invio} onClick={() => mandaCodice(true)} className="font-semibold text-primary-700 underline disabled:opacity-60">rimanda il codice</button>
          {' · '}
          <button type="button" onClick={() => { setFase('scelta'); setErrore(null); }} className="font-semibold text-primary-700 underline">ho sbagliato email</button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={conferma} className="mt-6" aria-label="Conferma l’abbonamento">
      <fieldset>
        <legend className="text-lg font-bold text-ink-900">I tre abbonamenti</legend>
        <p className="mt-1 text-sm text-ink-600">Ognuno comprende tutti i servizi: cambia quanto.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {fasce.map((f) => {
            const attiva = f.id === fascia;
            return (
              <label key={f.id} data-fascia={f.id} className="block cursor-pointer">
                <input
                  type="radio"
                  name="fascia"
                  value={f.id}
                  checked={attiva}
                  onChange={() => setFascia(f.id)}
                  className="peer sr-only"
                />
                <span
                  className={`flex h-full flex-col rounded-2xl border-2 p-4 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 ${attiva ? 'border-primary-700 bg-primary-50' : 'border-cream-200 bg-surface-0 hover:border-primary-300'}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-xl font-bold text-ink-900">{f.nome}</span>
                    {f.id === segnata && (
                      <span className="rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">{dalVenditore ? 'La tua scelta' : 'Consigliato'}</span>
                    )}
                    {attiva && <Check size={18} className="ml-auto text-primary-700" aria-hidden />}
                  </span>
                  <span className="mt-1 block text-lg font-extrabold text-ink-900">{f.canone}</span>
                  {f.primoMese && <span className="block text-xs font-semibold text-olive-800">Il primo mese {f.primoMese}</span>}
                  <span className="mt-2 block text-sm text-ink-700">{f.perChi}</span>
                  <span className="mt-3 block space-y-1 border-t border-cream-200 pt-3 text-sm text-ink-700">
                    {f.servizi.map((s) => (
                      <span key={s.titolo} className="block"><strong className="text-ink-900">{s.titolo}:</strong> {s.testo}</span>
                    ))}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
        <label className="block text-sm font-medium text-ink-800" htmlFor="email-titolare">La tua email</label>
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
        <p className="mt-1 text-xs text-ink-500">Ti mandiamo qui un codice per entrare nella tua pagina, e il link per rientrare quando vuoi.</p>
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
          className="mt-4 w-full rounded-lg bg-primary-700 py-3 text-lg font-bold text-white hover:bg-primary-800 disabled:opacity-60"
        >
          {invio ? 'Un momento…' : `Confermo il ${scelta.nome}`}
        </button>
        {!PAGAMENTO_ONLINE_SERVIZI && <p className="mt-2 text-center text-xs text-ink-600">{FRASE_CONTANTI}</p>}
      </div>
    </form>
  );
}
