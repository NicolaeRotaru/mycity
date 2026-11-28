'use client';

// LA MAPPA DEI CLIENTI DA VISITARE — 28/11/2026 (migrazione 999i).
// Nicola: «la mappa deve visualizzarsi in 2 modi: 1) sulla mappa, 2) una lista che si può ordinare, e un ordine è la
// priorità del cliente da contattare». Le attività vengono dal flusso n8n 16 (tutta la fila). Ognuno vede tutto;
// «Ci vado io» e il cliente è tuo, gli altri lo vedono preso; «Lascio» e torna libero. Dopo la visita, una parola.
// Il primo contatto lo fa sempre una persona, di persona o al telefono: da qui non parte nessun messaggio.

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { Cliente, Stato } from '@/lib/agenti/clienti';
import { PAROLA_STATO } from '@/lib/agenti/clienti';
import { ICONE } from '@/components/agenti/IconaCategoria';
import { CATEGORIE, COLORI, ORDINI, categoriaDi, coloreDi, daMostrare, metri, ordina, telDaChiamare, STATI_DOPO_LA_VISITA, type Ordine } from '@/lib/agenti/clienti-vista';

const MappaClienti = dynamic(() => import('@/components/agenti/MappaClienti'), {
  ssr: false,
  loading: () => <div className="h-[55vh] w-full animate-pulse rounded-2xl bg-surface-100" />,
});

const ALL_ACCESSO = `/sign-in?returnTo=${encodeURIComponent('/agente/clienti')}`;
const PER_PAGINA = 40;
type Risposta<T> = { ok?: boolean; data?: T; error?: { message?: string } } | null;

function Pallino({ c }: { c: Pick<Cliente, 'stato' | 'presa' | 'tipo' | 'segmento'> }) {
  const Icona = ICONE[categoriaDi(c)];
  return (
    <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-white shadow" style={{ background: COLORI[coloreDi(c)].tinta }}>
      <Icona size={14} color="#FFFFFF" strokeWidth={2.25} />
    </span>
  );
}

function Scheda({ c, admin, occupato, onAzione }: { c: Cliente; admin: boolean; occupato: boolean; onAzione: (azione: 'prendi' | 'lascia' | 'stato', stato?: Stato) => void }) {
  const tel = telDaChiamare(c.telefono);
  const puoCambiare = c.presa === 'mia' || admin;
  return (
    <article className="rounded-2xl border border-surface-200 bg-white p-4 shadow-sm" aria-label={`Scheda di ${c.nome}`}>
      <div className="flex items-start gap-2">
        <Pallino c={c} />
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-extrabold leading-tight text-ink-900">{c.nome}</h2>
          <p className="text-sm text-ink-600">{[c.tipo, metri(c.distanzaM) && `${metri(c.distanzaM)} da Pane Quotidiano`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-700">
        <b>{COLORI[coloreDi(c)].parola}</b>
        {c.stato !== 'da_visitare' && c.presa !== 'libera' && ` · ${c.presa === 'mia' ? 'presa da me' : 'presa da un altro'}`}
        {admin && c.presaDa && ` · ${c.presaDa}`}
        {!c.inFila && ' · non è più nella fila del lunedì'}
      </p>
      {c.indirizzo && <p className="mt-2 text-sm text-ink-700">{c.indirizzo}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {tel ? <a href={`tel:${tel}`} className="rounded-full bg-ink-900 px-4 py-2 text-sm font-semibold text-white">Chiama {c.telefono}</a>
          : <span className="rounded-full bg-surface-100 px-4 py-2 text-sm text-ink-600">Telefono da trovare</span>}
        {c.mappa && <a href={c.mappa} target="_blank" rel="noopener noreferrer" className="rounded-full border border-ink-900 px-4 py-2 text-sm font-semibold text-ink-900">Apri su Google Maps</a>}
      </div>
      {c.perche && <p className="mt-3 text-sm text-ink-700"><b>Perché è in lista:</b> {c.perche}.</p>}
      {c.offerta && <p className="mt-1 text-sm text-ink-700"><b>Cosa proporre:</b> {c.offerta} <span className="text-ink-500">(da verificare: la mappa può essere vecchia)</span>.</p>}
      {c.dossier && (
        <details className="mt-2 text-sm text-ink-700" open>
          <summary className="cursor-pointer font-semibold">Dossier dell’AD{c.settimana ? ` · settimana del ${c.settimana.split('-').reverse().slice(0, 2).join('/')}` : ''}</summary>
          <p className="mt-1 whitespace-pre-line">{c.dossier}</p>
        </details>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {c.presa === 'libera' && <button type="button" disabled={occupato} onClick={() => onAzione('prendi')} className="rounded-full bg-primary-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60">Ci vado io</button>}
        {(c.presa === 'mia' || (admin && c.presa === 'altro')) && <button type="button" disabled={occupato} onClick={() => onAzione('lascia')} className="rounded-full border border-primary-600 px-5 py-2 text-sm font-bold text-primary-700 disabled:opacity-60">{c.presa === 'mia' ? 'Lascio' : 'Libera'}</button>}
        {c.presa === 'altro' && !admin && <span className="rounded-full bg-surface-100 px-4 py-2 text-sm text-ink-600">L’ha presa un altro agente</span>}
      </div>
      {puoCambiare && (
        <div className="mt-3" role="group" aria-label="Com’è andata la visita">
          <p className="text-sm font-semibold text-ink-900">Dopo la visita:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {STATI_DOPO_LA_VISITA.map((s) => (
              <button key={s} type="button" disabled={occupato} aria-pressed={c.stato === s} onClick={() => onAzione('stato', c.stato === s ? 'da_visitare' : s)}
                className={`rounded-full border px-4 py-1.5 text-sm font-semibold disabled:opacity-60 ${c.stato === s ? 'border-ink-900 bg-ink-900 text-white' : 'border-surface-300 text-ink-800'}`}>
                {PAROLA_STATO[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function PaginaClienti() {
  const [clienti, setClienti] = useState<Cliente[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [vista, setVista] = useState<'mappa' | 'lista'>('mappa');
  const [ordine, setOrdine] = useState<Ordine>('priorita');
  const [cerca, setCerca] = useState('');
  const [quante, setQuante] = useState(PER_PAGINA);
  const [scelto, setScelto] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [io, setIo] = useState<{ lat: number; lon: number } | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch('/api/agente/clienti', { cache: 'no-store' });
      if (r.status === 401) { location.href = ALL_ACCESSO; return; }
      const d = (await r.json().catch(() => null)) as Risposta<{ admin: boolean; clienti: Cliente[] }>;
      if (!r.ok || !d?.data) { setErrore(d?.error?.message ?? 'La mappa non si carica: riprova fra poco.'); return; }
      setClienti(d.data.clienti); setAdmin(d.data.admin); setErrore(null);
    } catch { setErrore('Niente rete, o il sito non risponde. Riprova fra un attimo.'); }
  }, []);

  useEffect(() => { carica(); }, [carica]);

  // «Vicino a me» chiede la posizione solo quando lo si sceglie, e non la manda a nessuno: serve solo a ordinare qui.
  useEffect(() => {
    if (ordine !== 'vicino' || io || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setIo({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setErrore('Non ho la tua posizione: la lista resta per priorità.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 },
    );
  }, [ordine, io]);

  const visibili = useMemo(() => (clienti ?? []).filter(daMostrare), [clienti]);
  const inLista = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    const filtrati = t ? visibili.filter((c) => `${c.nome} ${c.tipo ?? ''} ${c.indirizzo ?? ''}`.toLowerCase().includes(t)) : visibili;
    return ordina(filtrati, ordine, io);
  }, [visibili, ordine, io, cerca]);
  const senzaPosizione = useMemo(() => visibili.filter((c) => c.lat === null || c.lon === null).length, [visibili]);
  const scheda = useMemo(() => visibili.find((c) => c.osm === scelto) ?? null, [visibili, scelto]);
  const conti = useMemo(() => ({
    mie: visibili.filter((c) => c.presa === 'mia').length,
    libere: visibili.filter((c) => c.presa === 'libera' && c.stato === 'da_visitare').length,
  }), [visibili]);

  async function tocca(osm: string, azione: 'prendi' | 'lascia' | 'stato', stato?: Stato) {
    setOccupato(true);
    try {
      const r = await fetch('/api/agente/clienti', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ osm, azione, stato }) });
      if (r.status === 401) { location.href = ALL_ACCESSO; return; }
      const d = (await r.json().catch(() => null)) as Risposta<Cliente>;
      if (r.ok && d?.data) {
        const nuovo = d.data;
        setClienti((l) => (l ?? []).map((c) => (c.osm === nuovo.osm ? { ...c, ...nuovo } : c)));
        setErrore(null);
      } else {
        setErrore(d?.error?.message ?? 'Non è andata: riprova.');
        if (r.status === 409 || r.status === 403) carica(); // qualcun altro è stato più svelto: si rilegge la mappa
      }
    } catch { setErrore('Niente rete: riprova fra un attimo.'); }
    finally { setOccupato(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/agente" className="text-sm font-semibold text-primary-700 underline">← Scheda del cliente</Link>
        <span className="text-sm text-ink-600"><b>MyCity</b> · Agenti</span>
      </div>
      <h1 className="mt-3 font-serif text-2xl font-extrabold text-ink-900">Clienti da visitare</h1>
      <p className="mt-1 text-sm text-ink-600">
        Le attività entro 5 km da Pane Quotidiano, in ordine di priorità. Tocca «Ci vado io» e il cliente è tuo: gli altri lo vedono preso.
        Il primo contatto lo fai tu, di persona o al telefono.
      </p>
      {clienti && <p className="mt-1 text-sm text-ink-700">{visibili.length} attività · {conti.libere} libere · {conti.mie} tue</p>}

      <div className="mt-4 flex gap-2" role="tablist" aria-label="Come vederle">
        {(['mappa', 'lista'] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
            className={`rounded-full px-5 py-2 text-sm font-bold ${vista === v ? 'bg-ink-900 text-white' : 'border border-surface-300 text-ink-800'}`}>
            {v === 'mappa' ? 'Mappa' : 'Lista'}
          </button>
        ))}
      </div>

      {errore && <p className="mt-3 rounded-xl bg-secondary-50 px-3 py-2 text-sm text-secondary-700" role="alert">{errore}</p>}
      {!clienti && !errore && <p className="mt-4 text-sm text-ink-600" role="status">Carico la mappa…</p>}
      {clienti && !visibili.length && <p className="mt-4 text-sm text-ink-700">La mappa è ancora vuota: si riempie al prossimo giro del flusso, il lunedì alle 7:10.</p>}

      {clienti && visibili.length > 0 && vista === 'mappa' && (
        <div className="mt-4">
          <MappaClienti clienti={visibili} scelto={scelto} onScegli={setScelto} io={io} />
          {senzaPosizione > 0 && <p className="mt-2 text-xs text-ink-600">{senzaPosizione} {senzaPosizione === 1 ? 'attività non ha' : 'attività non hanno'} la posizione: {senzaPosizione === 1 ? 'la trovi' : 'le trovi'} nella Lista.</p>}
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label="Legenda dei colori: lo stato">
            {Object.entries(COLORI).map(([k, v]) => (
              <li key={k} className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: v.tinta }} />{v.parola}</li>
            ))}
          </ul>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label="Legenda delle icone: la categoria">
            {(Object.keys(CATEGORIE) as (keyof typeof CATEGORIE)[]).map((k) => {
              const Icona = ICONE[k];
              return <li key={k} className="flex items-center gap-1"><Icona size={13} aria-hidden="true" />{CATEGORIE[k]}</li>;
            })}
          </ul>
          <p className="mt-1 text-xs text-ink-500">La lista mostra le stesse attività, una sotto l’altra.</p>
          {scheda ? <div className="mt-4"><Scheda c={scheda} admin={admin} occupato={occupato} onAzione={(a, s) => tocca(scheda.osm, a, s)} /></div>
            : <p className="mt-3 text-sm text-ink-600">Tocca un puntino per aprire la scheda dell’attività.</p>}
        </div>
      )}

      {clienti && visibili.length > 0 && vista === 'lista' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold text-ink-900">Ordina per
              <select value={ordine} onChange={(e) => { setOrdine(e.target.value as Ordine); setQuante(PER_PAGINA); }} className="ml-2 rounded-lg border border-surface-300 px-2 py-1.5 text-sm font-normal">
                {ORDINI.map((o) => <option key={o.valore} value={o.valore}>{o.parola}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-ink-900">Cerca
              <input type="search" value={cerca} onChange={(e) => { setCerca(e.target.value); setQuante(PER_PAGINA); }} placeholder="nome, tipo o via" className="ml-2 rounded-lg border border-surface-300 px-2 py-1.5 text-sm font-normal" />
            </label>
          </div>
          <ol className="mt-3 divide-y divide-surface-200 rounded-2xl border border-surface-200 bg-white">
            {inLista.slice(0, quante).map((c, i) => (
              <li key={c.osm}>
                <button type="button" onClick={() => setScelto(scelto === c.osm ? null : c.osm)} aria-expanded={scelto === c.osm}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className="w-7 shrink-0 text-right text-xs text-ink-500">{i + 1}</span>
                  <Pallino c={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink-900">{c.nome}</span>
                    <span className="block truncate text-xs text-ink-600">{[c.tipo, metri(c.distanzaM), COLORI[coloreDi(c)].parola].filter(Boolean).join(' · ')}</span>
                  </span>
                  {c.punteggio !== null && <span className="shrink-0 text-xs text-ink-500" title="Priorità (punteggio della macchina)">{c.punteggio.toLocaleString('it-IT')}</span>}
                </button>
                {scelto === c.osm && <div className="px-3 pb-3"><Scheda c={c} admin={admin} occupato={occupato} onAzione={(a, s) => tocca(c.osm, a, s)} /></div>}
              </li>
            ))}
          </ol>
          {inLista.length > quante && (
            <button type="button" onClick={() => setQuante((q) => q + PER_PAGINA)} className="mt-3 w-full rounded-full border border-surface-300 py-2 text-sm font-semibold text-ink-800">
              Mostra altre {Math.min(PER_PAGINA, inLista.length - quante)} (ne restano {inLista.length - quante})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
