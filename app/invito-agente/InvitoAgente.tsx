'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { CHIAVE_CODICE, CODICE_INVITO, DURATA_CODICE_MS, PERCORSO_INVITO } from '@/lib/agenti/codice';

type Stato = 'valido' | 'usato' | 'scaduto' | 'ritirato' | 'inesistente' | 'guasto' | 'senza-codice';

/**
 * Il codice dopo il «#»: lo tengo nel browser per un giorno e lo tolgo dalla barra. Serve perché la persona, per
 * diventare agente, prima crea l'account e conferma l'email, e la conferma può aprirsi in un'altra scheda.
 */
function prendiIlCodice(): string | null {
  const dalLink = location.hash.slice(1);
  if (CODICE_INVITO.test(dalLink)) {
    try { localStorage.setItem(CHIAVE_CODICE, JSON.stringify({ codice: dalLink, il: Date.now() })); } catch { /* memoria del browser chiusa: si usa e basta */ }
    history.replaceState(null, '', location.pathname + location.search);
    return dalLink;
  }
  try {
    const tenuto = JSON.parse(localStorage.getItem(CHIAVE_CODICE) ?? 'null') as { codice?: string; il?: number } | null;
    if (tenuto?.codice && CODICE_INVITO.test(tenuto.codice) && Date.now() - (tenuto.il ?? 0) < DURATA_CODICE_MS) return tenuto.codice;
    localStorage.removeItem(CHIAVE_CODICE);
  } catch { /* niente di tenuto */ }
  return null;
}

function dimenticaIlCodice() {
  try { localStorage.removeItem(CHIAVE_CODICE); } catch { /* niente da togliere */ }
}

const CHIUSO: Record<'usato' | 'scaduto' | 'ritirato' | 'inesistente', string> = {
  usato: 'Questo link è già stato usato.',
  scaduto: 'Questo link è scaduto.',
  ritirato: 'Questo link è stato ritirato.',
  inesistente: 'Questo link non esiste.',
};

const riquadro = 'mt-6 rounded-xl border border-cream-200 bg-surface-0 p-4';
const bottone = 'inline-block rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60';
const ritorno = encodeURIComponent(PERCORSO_INVITO);

export default function InvitoAgente({ emailCollegata, giaDentro }: { emailCollegata: string | null; giaDentro: 'agente' | 'admin' | null }) {
  const [codice, setCodice] = useState<string | null>(null);
  const [stato, setStato] = useState<Stato | null>(null);
  const [accetto, setAccetto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);

  useEffect(() => {
    const c = prendiIlCodice();
    if (!c) { setStato('senza-codice'); return; }
    setCodice(c);
    fetch('/api/invito-agente/stato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codice: c }), cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { data?: { stato?: Stato } }) => setStato(d?.data?.stato ?? 'guasto'))
      .catch(() => setStato('guasto'));
  }, []);

  async function attiva() {
    setErrore(null);
    if (!accetto) { setErrore('Per continuare accetta le condizioni e l’informativa privacy.'); return; }
    setAttesa(true);
    try {
      const r = await fetch('/api/invito-agente/attiva', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codice, accettoCondizioni: true }) });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
      if (!r.ok || !d?.ok) throw new Error(d?.error?.message ?? 'Non riesco a continuare. Riprova.');
      dimenticaIlCodice();
      window.location.href = '/agente';
    } catch (err) { setErrore(err instanceof Error ? err.message : 'Attivazione non riuscita.'); } finally { setAttesa(false); }
  }

  async function esci() {
    await supabase.auth.signOut().catch(() => undefined);
    window.location.reload();
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-label text-ink-600">MyCity · SDG Agenzia</p>
      <h1 className="mt-1 font-serif text-3xl font-extrabold text-ink-900">Invito per gli agenti</h1>
      <p className="mt-2 text-sm text-ink-600">Con questo invito entri nella pagina degli agenti: incolli il link di Google Maps di un negozio e ricevi la scheda del cliente prima di entrare.</p>

      {giaDentro ? (
        <div className={riquadro}>
          <p className="text-sm text-ink-900">{giaDentro === 'admin' ? 'Sei l’admin: la pagina degli agenti è già aperta per te, questo link non serve (e così resta valido per chi lo deve usare).' : 'Sei già un agente di MyCity.'}</p>
          <Link href="/agente" className={`mt-3 ${bottone}`}>Apri la pagina della scheda</Link>
        </div>
      ) : stato === null ? (
        <p className="mt-6 text-sm text-ink-600" role="status">Controllo il link…</p>
      ) : stato === 'senza-codice' ? (
        <div className={riquadro}>
          <p className="text-sm text-ink-900">Non trovo il codice dell’invito.</p>
          <p className="mt-1 text-sm text-ink-600">Riapri il link che ti ha mandato Nicola, dal suo messaggio (non dalla cronologia del browser).</p>
        </div>
      ) : stato === 'guasto' ? (
        <div className={riquadro} role="alert">
          <p className="text-sm text-ink-900">Non riesco a controllare il link in questo momento.</p>
          <p className="mt-1 text-sm text-ink-600">Riprova fra qualche minuto: il link resta valido.</p>
        </div>
      ) : stato !== 'valido' ? (
        <div className={riquadro}>
          <p className="text-sm text-ink-900">{CHIUSO[stato]}</p>
          <p className="mt-1 text-sm text-ink-600">Chiedi a Nicola un link nuovo.</p>
        </div>
      ) : emailCollegata ? (
        <div className={riquadro}>
          <p className="text-sm text-ink-900">Sei entrato come <b>{emailCollegata}</b>. Premendo «Attiva», questo account diventa il tuo accesso da agente.</p>
          <label className="mt-3 flex items-start gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={accetto} onChange={(e) => setAccetto(e.target.checked)} className="mt-1" />
            <span>Accetto le <Link href="/terms" className="underline">condizioni</Link> e l’<Link href="/privacy" className="underline">informativa privacy</Link>.</span>
          </label>
          <button type="button" disabled={attesa} onClick={attiva} className={`mt-3 ${bottone}`}>
            {attesa ? 'Attivo…' : 'Attiva il mio accesso da agente'}
          </button>
          {errore && <p role="alert" className="mt-2 text-sm text-secondary-700">{errore}</p>}
          <p className="mt-3 text-sm text-ink-600">Non sei tu? <button type="button" onClick={esci} className="font-semibold underline">Esci</button> e poi entra col tuo account.</p>
        </div>
      ) : (
        <div className={`${riquadro} space-y-3`}>
          <p className="text-sm text-ink-900"><b>Due passi.</b> Prima crei il tuo account MyCity con email e password, e confermi l’email dal messaggio che ti arriva. Poi torni qui e premi «Attiva».</p>
          <Link href={`/sign-up?returnTo=${ritorno}`} className={`${bottone} w-full text-center`}>Crea il mio account</Link>
          <p className="text-sm text-ink-600">Hai già un account MyCity? <Link href={`/sign-in?returnTo=${ritorno}`} className="font-semibold underline">Entra</Link>. Se dopo l’accesso finisci sul tuo pannello, riapri il link di Nicola.</p>
        </div>
      )}
    </div>
  );
}
