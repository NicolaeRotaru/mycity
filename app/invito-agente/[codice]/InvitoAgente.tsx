'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

type Stato = 'valido' | 'usato' | 'scaduto' | 'ritirato' | 'inesistente' | 'guasto';

const CHIUSO: Record<Exclude<Stato, 'valido'>, string> = {
  usato: 'Questo link è già stato usato.',
  scaduto: 'Questo link è scaduto.',
  ritirato: 'Questo link è stato ritirato.',
  inesistente: 'Questo link non esiste.',
  guasto: 'Non riesco a leggere il link in questo momento. Riprova fra poco.',
};

const campo = 'mt-1 w-full rounded-lg border border-cream-300 bg-surface-0 px-3 py-2.5 text-base text-ink-900';

export default function InvitoAgente({ codice, stato, emailCollegata, giaAgente }: { codice: string; stato: Stato; emailCollegata: string | null; giaAgente: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ripeti, setRipeti] = useState('');
  const [accetto, setAccetto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [attesa, setAttesa] = useState(false);
  const ritorno = `/invito-agente/${codice}`;

  async function chiama(indirizzo: string, corpo?: unknown) {
    const r = await fetch(indirizzo, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {}) });
    const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
    if (!r.ok || !d?.ok) throw new Error(d?.error?.message ?? 'Non riesco a continuare. Riprova.');
  }

  async function iscriviti(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    if (password !== ripeti) { setErrore('Le due password non sono uguali.'); return; }
    setAttesa(true);
    try {
      await chiama(`/api/invito-agente/${codice}/iscriviti`, { email, password, accettoCondizioni: accetto });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) { window.location.href = `/sign-in?returnTo=${encodeURIComponent('/agente')}`; return; }
      window.location.href = '/agente';
    } catch (err) { setErrore(err instanceof Error ? err.message : 'Iscrizione non riuscita.'); } finally { setAttesa(false); }
  }

  async function attiva() {
    setErrore(null); setAttesa(true);
    try { await chiama(`/api/invito-agente/${codice}/attiva`); window.location.href = '/agente'; }
    catch (err) { setErrore(err instanceof Error ? err.message : 'Attivazione non riuscita.'); } finally { setAttesa(false); }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-600">MyCity · SDG Agenzia</p>
      <h1 className="mt-1 font-serif text-3xl font-extrabold text-ink-900">Invito per gli agenti</h1>
      <p className="mt-2 text-sm text-ink-600">Con questo invito entri nella pagina degli agenti: incolli il link di Google Maps di un negozio e ricevi la scheda del cliente prima di entrare.</p>

      {giaAgente ? (
        <div className="mt-6 rounded-xl border border-cream-200 bg-surface-0 p-4">
          <p className="text-sm text-ink-900">Sei già un agente di MyCity.</p>
          <Link href="/agente" className="mt-3 inline-block rounded-lg bg-ink-900 px-4 py-2 text-sm font-bold text-white">Apri la pagina della scheda</Link>
        </div>
      ) : stato !== 'valido' ? (
        <div className="mt-6 rounded-xl border border-cream-200 bg-surface-0 p-4">
          <p className="text-sm text-ink-900">{CHIUSO[stato]}</p>
          <p className="mt-1 text-sm text-ink-600">Chiedi a Nicola un link nuovo.</p>
        </div>
      ) : emailCollegata ? (
        <div className="mt-6 rounded-xl border border-cream-200 bg-surface-0 p-4">
          <p className="text-sm text-ink-900">Sei entrato come <b>{emailCollegata}</b>.</p>
          <button type="button" disabled={attesa} onClick={attiva} className="mt-3 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {attesa ? 'Attivo…' : 'Attiva il mio accesso da agente'}
          </button>
          {errore && <p role="alert" className="mt-2 text-sm text-secondary-700">{errore}</p>}
        </div>
      ) : (
        <form onSubmit={iscriviti} className="mt-6 space-y-3 rounded-xl border border-cream-200 bg-surface-0 p-4">
          <label className="block text-sm font-semibold text-ink-900">Email
            <input type="email" required autoComplete="email" inputMode="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} />
          </label>
          <label className="block text-sm font-semibold text-ink-900">Password (almeno 8 caratteri)
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={campo} />
          </label>
          <label className="block text-sm font-semibold text-ink-900">Ripeti la password
            <input type="password" required autoComplete="new-password" value={ripeti} onChange={(e) => setRipeti(e.target.value)} className={campo} />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={accetto} onChange={(e) => setAccetto(e.target.checked)} className="mt-1" />
            <span>Accetto le <Link href="/terms" className="underline">condizioni</Link> e l’<Link href="/privacy" className="underline">informativa privacy</Link>.</span>
          </label>
          <button type="submit" disabled={attesa} className="w-full rounded-lg bg-ink-900 px-4 py-3 text-base font-bold text-white disabled:opacity-60">
            {attesa ? 'Un attimo…' : 'Crea il mio account da agente'}
          </button>
          {errore && <p role="alert" className="text-sm text-secondary-700">{errore}</p>}
          <p className="text-sm text-ink-600">Hai già un account MyCity? <Link href={`/sign-in?returnTo=${encodeURIComponent(ritorno)}`} className="underline">Entra</Link> e poi riapri questo link.</p>
        </form>
      )}
    </main>
  );
}
