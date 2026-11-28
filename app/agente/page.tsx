'use client';

// LA PAGINA DELL'AGENTE — una casella, un pulsante, la scheda del cliente (26/11/2026).
// Il tempo conta (l'agente è in strada): la prima scheda arriva in pochi secondi, poi si completa da sola
// quando l'AD ha finito (flussi n8n 14 e 14b con «Chiedi all'AD»). Le schede restano legate al suo account.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Scheda from '@/components/agenti/Scheda';
import AggiungiAttivita from '@/components/agenti/AggiungiAttivita';
import st from '@/components/agenti/scheda.module.css';
import type { Scheda as TScheda } from '@/lib/agenti/scheda';

type Fase = 'pronto' | 'leggo' | 'cerca' | 'fatto' | 'errore';
type Ultima = { lavoro: string; nome: string; stato?: string; iniziato?: number | null };
/** 27/11/2026 — Un'attività che il titolare ha già confermato: si riapre «Adesso tocca a SDG». */
type Confermata = { lavoro: string; nome: string };
type Risposta<T> = { ok?: boolean; data?: T; error?: { message?: string } } | null;

const OGNI_MS = 3000;
const PAZIENZA_S = 600; // poi si smette di chiedere (l'AD aspetta al massimo 15 minuti)
const ALL_ACCESSO = `/sign-in?returnTo=${encodeURIComponent('/agente')}`;
const c = (nomi: string) => nomi.split(/\s+/).filter(Boolean).map((n) => st[n] ?? n).join(' ');

async function leggi<T>(r: Response): Promise<Risposta<T>> {
  return (await r.json().catch(() => null)) as Risposta<T>;
}

/** Le mie ultime schede e chi sono (le schede stanno nella tabella n8n, legate al mio account). */
async function chiediLeMie(): Promise<{ email: string | null; schede: Ultima[]; confermate: Confermata[] }> {
  try {
    const r = await fetch('/api/agente/schede', { cache: 'no-store' });
    if (r.status === 401) { location.href = ALL_ACCESSO; return { email: null, schede: [], confermate: [] }; }
    const d = await leggi<{ email: string; schede: Ultima[]; confermate?: Confermata[] }>(r);
    return {
      email: d?.data?.email ?? null,
      schede: Array.isArray(d?.data?.schede) ? d.data.schede.slice(0, 8) : [],
      confermate: Array.isArray(d?.data?.confermate) ? d.data.confermate.slice(0, 8) : [],
    };
  } catch { return { email: null, schede: [], confermate: [] }; }
}

export default function PaginaAgente() {
  const [testo, setTesto] = useState('');
  // 28/11/2026 — Facoltativo: il sito o il profilo che il venditore vede sulla scheda Google (Raquel 💗 Cafè: sito non trovato).
  const [canale, setCanale] = useState('');
  const [fase, setFase] = useState<Fase>('pronto');
  const [errore, setErrore] = useState<string | null>(null);
  const [scheda, setScheda] = useState<TScheda | null>(null);
  const [lavoro, setLavoro] = useState<string | null>(null);
  const [secondi, setSecondi] = useState(0);
  const [ultime, setUltime] = useState<Ultima[]>([]);
  const [confermate, setConfermate] = useState<Confermata[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const inizio = useRef(0);
  const giro = useRef(0);

  const ferma = () => { giro.current++; };

  const segui = useCallback((id: string, dalPrincipio: number) => {
    const mio = ++giro.current;
    let sconosciuti = 0;
    inizio.current = dalPrincipio;
    const chiedi = async () => {
      if (mio !== giro.current) return;
      const passati = Math.round((Date.now() - inizio.current) / 1000);
      if (passati > PAZIENZA_S) { setFase('errore'); setErrore('L’AD non ha risposto in 10 minuti. La prima scheda resta qui; riprova più tardi con «Analizza».'); return; }
      try {
        const r = await fetch(`/api/agente/stato?lavoro=${id}`, { cache: 'no-store' });
        if (r.status === 401) { location.href = ALL_ACCESSO; return; }
        const d = await leggi<{ stato: string; scheda?: TScheda; errore?: string }>(r);
        if (mio !== giro.current) return;
        if (d?.data?.scheda) setScheda(d.data.scheda);
        if (d?.data?.stato === 'pronta') { setFase('fatto'); chiediLeMie().then((x) => setUltime(x.schede)); return; }
        if (d?.data?.stato === 'errore') { setFase('errore'); setErrore(`L’AD non è riuscito a finire: ${d.data.errore}. La prima scheda resta valida.`); return; }
        // Una scheda che non c'è (o non è mia) non diventerà mai pronta: tre risposte così e ci si ferma.
        if (r.status === 404) { sconosciuti += 1; if (sconosciuti >= 3) { setFase('errore'); setErrore(d?.error?.message ?? 'Questa scheda non si trova.'); return; } }
      } catch { /* rete ballerina: si riprova al prossimo giro */ }
      setTimeout(chiedi, OGNI_MS);
    };
    setTimeout(chiedi, 1500);
  }, []);

  // Riaprire una scheda dal link (?lavoro=…) o dalle ultime.
  const riapri = useCallback((id: string) => {
    ferma(); setErrore(null); setScheda(null); setLavoro(id); setFase('cerca');
    history.replaceState(null, '', `?lavoro=${id}`);
    segui(id, Date.now());
  }, [segui]);

  useEffect(() => {
    chiediLeMie().then((x) => { setUltime(x.schede); setEmail(x.email); setConfermate(x.confermate); });
    const id = new URLSearchParams(location.search).get('lavoro');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) riapri(id);
  }, [riapri]);

  useEffect(() => {
    if (fase !== 'leggo' && fase !== 'cerca') return;
    const t = setInterval(() => setSecondi(Math.round((Date.now() - inizio.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [fase]);

  async function analizza(e?: React.FormEvent) {
    e?.preventDefault();
    if (!testo.trim() || fase === 'leggo') return;
    ferma(); setErrore(null); setScheda(null); setLavoro(null); setFase('leggo');
    inizio.current = Date.now(); setSecondi(0);
    try {
      const r = await fetch('/api/agente/analizza', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testo, ...(canale.trim() ? { canale: canale.trim() } : {}) }) });
      if (r.status === 401) { location.href = ALL_ACCESSO; return; }
      const d = await leggi<{ lavoro: string | null; scheda: TScheda }>(r);
      if (!r.ok || !d?.data) { setFase('errore'); setErrore(d?.error?.message ?? 'Qualcosa non va: riprova.'); return; }
      setScheda(d.data.scheda);
      if (d.data.lavoro) {
        setLavoro(d.data.lavoro); setFase('cerca');
        history.replaceState(null, '', `?lavoro=${d.data.lavoro}`);
        segui(d.data.lavoro, inizio.current);
      } else { setFase('errore'); setErrore(d.data.scheda?.avvisi?.at(-1) ?? 'L’AD non è partito: hai solo la prima scheda.'); }
    } catch {
      setFase('errore'); setErrore('Niente rete, o il sito non risponde. Riprova fra un attimo.');
    }
  }

  async function incolla() {
    try { const t = await navigator.clipboard.readText(); if (t) setTesto(t.trim()); } catch { /* il telefono non lo permette: si incolla a mano */ }
  }

  const percento = fase === 'leggo' ? Math.min(12, secondi * 3) : fase === 'cerca' ? Math.min(95, 12 + secondi * 1.4) : 100;
  const passo = (soglia: number) => (secondi >= soglia ? 'fatto' : 'ora');

  return (
    <div className={c('radice')}>
      <div className={c('pagina')}>
        <div className={c('testata')}>
          <div className={c('barraAlta')}>
            <span className={c('marchio')}><b>MyCity</b> · Agenti</span>
            {email && <span className={c('nota')}>{email}</span>}
          </div>
          {/* 28/11/2026 — La mappa dei clienti da visitare (flusso n8n 16, migrazione 999i). */}
          <Link href="/agente/clienti" className={c('bottone secondario')}>Clienti da visitare: mappa e lista</Link>
          <h1>Scheda del cliente</h1>
          <p className={c('nota')}>Incolla il link di Google Maps dell’attività in cui stai per entrare e premi «Analizza». La prima parte arriva in pochi secondi, la scheda intera in circa un minuto.</p>
        </div>

        <form className={c('cerca')} onSubmit={analizza}>
          <label htmlFor="link">Link di Google Maps dell’attività</label>
          <div className={c('rigaCerca')}>
            <input id="link" className={c('campo')} type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
              placeholder="https://maps.app.goo.gl/…  oppure  nome e città" value={testo} onChange={(e) => setTesto(e.target.value)} />
            <button type="button" className={c('bottone secondario')} onClick={incolla}>Incolla</button>
            <button type="submit" className={c('bottone')} disabled={fase === 'leggo' || !testo.trim()}>{fase === 'leggo' ? 'Leggo…' : 'Analizza'}</button>
          </div>
          <p className={c('nota')}>Su Google Maps: apri l’attività → «Condividi» → «Copia link». Va bene anche scrivere il nome e la città.</p>
          <label htmlFor="canale">Sito o Instagram, se li vedi sulla scheda Google (facoltativo)</label>
          <input id="canale" className={c('campo')} type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={300}
            placeholder="www.illocale.it  oppure  @illocale" value={canale} onChange={(e) => setCanale(e.target.value)} />
          <p className={c('nota')}>Sulla scheda Google tocca «Sito web» o il profilo social e copia l’indirizzo: così la scheda li trova di sicuro.</p>
          {errore && <p className={c('errore')} role="alert">{errore}</p>}
          {/* 27/11/2026 — Le attività che hanno confermato: la pagina «Adesso tocca a SDG» si riapre da qui. */}
          {confermate.length > 0 && fase === 'pronto' && (
            <div className={c('ultime')} role="group" aria-label="Hanno confermato"><span className={c('nota')}>Hanno confermato:</span>{confermate.map((x) => <Link key={x.lavoro} href={`/agente/tocca-a-sdg?lavoro=${x.lavoro}`}><span aria-hidden="true">✓ </span>{x.nome}</Link>)}</div>
          )}
          {ultime.length > 0 && fase === 'pronto' && (
            <div className={c('ultime')} aria-label="Le tue ultime schede"><span className={c('nota')}>Le tue ultime schede:</span>{ultime.map((u) => <button type="button" key={u.lavoro} onClick={() => riapri(u.lavoro)}>{u.nome}</button>)}</div>
          )}
        </form>

        {(fase === 'leggo' || fase === 'cerca') && (
          <div className={c('attesa')} role="status" aria-live="polite">
            <div className={c('barra')} aria-hidden="true"><span style={{ width: `${percento}%` }} /></div>
            <ul className={c('passi')}>
              <li className={c(fase === 'leggo' ? 'ora' : 'fatto')}>{fase === 'leggo' ? '●' : '✓'} Leggo il link, l’indirizzo, il sito e i negozi vicini</li>
              <li className={c(fase === 'cerca' ? passo(20) : 'dopo')}>{fase === 'cerca' && secondi >= 20 ? '✓' : '●'} L’AD cerca social, recensioni e giornali</li>
              <li className={c(fase === 'cerca' && secondi >= 20 ? 'ora' : 'dopo')}>● L’AD sceglie l’abbonamento e scrive la scheda</li>
            </ul>
            <p className={c('nota')}>{secondi} secondi{secondi > 90 ? ' · ci mette più del solito: la scheda si completa da sola, intanto leggi la prima parte' : ''}</p>
          </div>
        )}

        <div id="scheda">{scheda && <Scheda s={scheda} />}</div>
        {/* 27/11/2026 — Il secondo momento con un clic (Nicola): quando il titolare dice sì, nasce il preventivo. */}
        {/* Solo a scheda finita: prima il tipo e l'indirizzo spesso mancano (collaudo del 27/11). */}
        {scheda && lavoro && fase === 'fatto' && <AggiungiAttivita key={lavoro} lavoro={lavoro} nome={scheda.nome} consigliato={scheda.consigliato} />}
        {fase === 'fatto' && lavoro && <p className={c('nota')}>La trovi fra «Le tue ultime schede», anche da un altro telefono dove entri col tuo account.</p>}
      </div>
    </div>
  );
}
