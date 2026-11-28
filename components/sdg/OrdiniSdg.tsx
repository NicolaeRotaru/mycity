'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { FASCE, euro } from '@/lib/agenti/fasce';
import type { OrdineSdg, StatoPianoCompleto } from '@/lib/agenzia/ordine-sdg';
import type { ColonnePezzi } from '@/lib/agenzia/pezzi-dell-ordine';
import { ETICHETTE_SERVIZI, servizioScelto } from '@/lib/agenzia/servizi-scelti';

/**
 * GLI ORDINI DI SERVIZIO DI SDG — 27/11/2026 (migrazione 999c).
 *
 * Nicola: quando il titolare conferma, «in automatico deve arrivare l'ordine del servizio, quindi nella pagina
 * venditore di SDG … con su scritto tutti i dati, quindi che abbonamento ha scelto l'imprenditore, e tutto il piano
 * editoriale già fatto». Un ordine per attività: i dati del locale, l'abbonamento e il canone, la visita, l'agente,
 * e il piano del primo mese nel formato del Caffè di Piacenza (data, ora, tipo, tema, didascalia, cosa riprendere,
 * evento in città). La stessa pagina sta in /seller/ordini-sdg (la pagina venditore di SDG) e in /admin/ordini-sdg:
 * oggi la apre Nicola, domani l'account di SDG. Chi altro prova vede il rifiuto della rotta (app/api/sdg/ordini).
 *
 * 28/11/2026 (migrazione 999h) — Con il piano nascono la bozza del sito e l'analisi all'avvio: ognuno dei tre ha il
 * suo stato (da collegare, in preparazione, pronto, non arrivato) e il suo pulsante per richiederlo all'AD. Il sito
 * è una bozza: da qui non si pubblica niente.
 */
const STATO_LAVORO: Record<StatoPianoCompleto, string> = {
  da_collegare: 'da collegare',
  in_corso: 'in preparazione',
  pronto: 'pronto',
  errore: 'non arrivato',
};
type Ordine = OrdineSdg & Partial<ColonnePezzi> & { visita: string };
type Azione = 'chiedi-piano' | 'chiedi-sito' | 'chiedi-analisi';

const STATO_PIANO: Record<StatoPianoCompleto, string> = {
  da_collegare: 'Piano completo dell’AD: da collegare',
  in_corso: 'Piano completo dell’AD: in preparazione',
  pronto: 'Piano completo dell’AD: pronto',
  errore: 'Piano completo dell’AD: non arrivato',
};
const NOMI_SERVIZI: Record<string, string> = { foto_video: 'Foto e video', sito_web: 'Sito', social: 'Social', analisi: 'Analisi' };
const quando = (d: string | null) => (d ? new Date(d).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }) : '—');
const giorno = (g: string) => new Date(`${g}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

async function leggi(): Promise<Ordine[]> {
  const r = await fetch('/api/sdg/ordini', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: Ordine[]; error?: { message?: string } } | null;
  if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Lettura non riuscita');
  return corpo.data ?? [];
}

export default function OrdiniSdg() {
  const { data, isLoading, error } = useQuery({ queryKey: ['sdg', 'ordini'], queryFn: leggi });
  const client = useQueryClient();
  const [chiedendo, setChiedendo] = useState<string | null>(null);

  async function chiedi(o: Ordine, azione: Azione) {
    setChiedendo(`${o.id}:${azione}`);
    try {
      const r = await fetch('/api/sdg/ordini', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: o.id, azione }) });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
      if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Non sono riuscito a chiederlo');
      toast.success(`${azione === 'chiedi-sito' ? 'Bozza del sito' : azione === 'chiedi-analisi' ? 'Analisi all’avvio' : 'Piano completo'} chiesto all’AD: arriva in qualche minuto`);
      await client.invalidateQueries({ queryKey: ['sdg', 'ordini'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Non sono riuscito a chiederlo');
    } finally {
      setChiedendo(null);
    }
  }

  if (isLoading) return <LoadingState />;
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Ordini di servizio di SDG</h1>
      <p className="mt-1 text-sm text-ink-600">
        Un ordine arriva da solo quando il titolare conferma l’abbonamento dal link del preventivo. Dentro ci sono i dati dell’attività, l’abbonamento, la visita, l’agente che l’ha portato e il piano editoriale del primo mese.
      </p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{(error as Error).message}</p>}
      {!error && (data ?? []).length === 0 && <p className="mt-6 rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-600">Nessun ordine, per ora: il primo arriva quando un titolare conferma.</p>}
      <div className="mt-6 grid gap-6">
        {(data ?? []).map((o) => <SchedaOrdine key={o.id} o={o} chiedendo={chiedendo?.startsWith(`${o.id}:`) ? (chiedendo.split(':')[1] as Azione) : null} chiedi={(azione) => chiedi(o, azione)} />)}
      </div>
    </div>
  );
}

function SchedaOrdine({ o, chiedendo, chiedi }: { o: Ordine; chiedendo: Azione | null; chiedi: (azione: Azione) => void }) {
  const chiediPiano = () => chiedi('chiedi-piano');
  const fascia = FASCE[o.fascia];
  const d = o.dati_attivita ?? ({} as Ordine['dati_attivita']);
  const s = d.dallaScheda;
  const piano = o.piano;
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-warm-sm" aria-labelledby={`ordine-${o.id}`}>
      <header className="border-b border-ink-100 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`ordine-${o.id}`} className="font-serif text-xl font-extrabold text-ink-900">{o.nome_attivita}</h2>
          <span className="rounded-full bg-primary-50 px-3 py-1 text-sm font-semibold text-primary-800">{fascia?.nome ?? o.fascia}</span>
        </div>
        <p className="mt-1 text-sm text-ink-600">{[s?.tipo ?? d.dettaglio, d.indirizzo, d.citta].filter(Boolean).join(' · ') || '—'}</p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold text-ink-900">Abbonamento</dt><dd className="text-ink-700">{fascia?.nome ?? o.fascia}: {o.canone_centesimi ? `${euro(o.canone_centesimi)} al mese` : 'canone da confermare'}{o.primo_mese_centesimi && o.primo_mese_centesimi !== o.canone_centesimi ? `, il primo mese ${euro(o.primo_mese_centesimi)}` : ''}. In contanti, al primo servizio.</dd></div>
          <div><dt className="font-semibold text-ink-900">Visita del team creativo</dt><dd className="text-ink-700">{o.visita.replace(/^Visita: /, '')}</dd></div>
          <div><dt className="font-semibold text-ink-900">Agente</dt><dd className="break-all text-ink-700">{o.agente_email ?? 'nessuno: preventivo nato fuori dalla pagina degli agenti'}</dd></div>
          <div><dt className="font-semibold text-ink-900">Confermato il</dt><dd className="text-ink-700">{quando(o.accettato_il)}</dd></div>
          {fascia && <div className="sm:col-span-2"><dt className="font-semibold text-ink-900">Cosa comprende</dt><dd className="text-ink-700">Sito: {fascia.inPratica.sito}. Contenuti: {fascia.inPratica.piano}. Foto e video: {fascia.inPratica.foto}. Analisi: {fascia.inPratica.analisi}.</dd></div>}
          <div className="sm:col-span-2"><dt className="font-semibold text-ink-900">Servizi scelti dall’agente</dt><dd className="text-ink-700">{(d.servizi ?? []).length ? (d.servizi ?? []).map((x) => ETICHETTE_SERVIZI[x] ?? x).join(' · ') : 'tutti e quattro (scelta non fatta)'}{d.notaAgente ? ` — nota: «${d.notaAgente}»` : ''}</dd></div>
          {s?.sito && <div><dt className="font-semibold text-ink-900">Sito di oggi</dt><dd className="break-all text-ink-700">{s.sito}</dd></div>}
          {s && s.social.length > 0 && <div><dt className="font-semibold text-ink-900">Social trovati</dt><dd className="break-all text-ink-700">{s.social.map((x) => (x.fonte ? `${x.canale} (${x.fonte})` : x.canale)).join(', ')}</dd></div>}
        </dl>
        {s && (s.perche || Object.keys(s.servizi ?? {}).length > 0) && (
          <div className="mt-4 rounded-xl bg-ink-50 p-3 text-sm">
            <p className="font-semibold text-ink-900">Su misura per {o.nome_attivita}, col {fascia?.nome ?? o.fascia} (dalla scheda dell’agente)</p>
            {s.perche && <p className="mt-1 text-ink-700">{s.perche}</p>}
            <ul className="mt-1 list-disc pl-5 text-ink-700">{Object.entries(s.servizi ?? {}).map(([k, v]) => <li key={k}><b>{NOMI_SERVIZI[k] ?? k}:</b> {v}</li>)}</ul>
          </div>
        )}
      </header>

      <section className="p-4 sm:p-5" aria-label={`Piano editoriale di ${o.nome_attivita}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-serif text-lg font-bold text-ink-900">Piano editoriale, {piano?.periodo?.titolo ?? 'primo mese'}</h3>
          <span className="text-sm text-ink-600">{piano?.origine === 'ad' ? 'Versione completa dell’AD' : 'Prima versione del sito'} · {piano?.contenuti?.length ?? 0} contenuti</span>
        </div>
        <p className="mt-1 text-sm text-ink-600">
          {STATO_PIANO[o.piano_completo_stato] ?? o.piano_completo_stato}
          {o.piano_completo_errore ? ` — ${o.piano_completo_errore}` : ''}
          {o.piano_completo_stato === 'pronto' && o.piano_completo_il ? ` (${quando(o.piano_completo_il)})` : ''}
        </p>
        {!servizioScelto(d.servizi, 'social') && <p className="mt-1 text-sm text-ink-600">«Gestione social e Google» non è fra i servizi scelti: il piano completo non si chiede all’AD.</p>}
        {servizioScelto(d.servizi, 'social') && (o.piano_completo_stato === 'da_collegare' || o.piano_completo_stato === 'errore') && (
          <button type="button" onClick={chiediPiano} disabled={chiedendo !== null} className="mt-2 rounded-lg border border-primary-600 px-3 py-1.5 text-sm font-semibold text-primary-700 disabled:opacity-60">
            {chiedendo === 'chiedi-piano' ? 'Chiedo…' : 'Chiedi il piano completo all’AD'}
          </button>
        )}
        {piano?.intestazione && (
          <dl className="mt-4 grid gap-2 text-sm">
            <div><dt className="inline font-semibold text-ink-900">Cliente: </dt><dd className="inline text-ink-700">{piano.intestazione.cliente}</dd></div>
            <div><dt className="inline font-semibold text-ink-900">Abbonamento: </dt><dd className="inline text-ink-700">{piano.intestazione.abbonamento}</dd></div>
            <div><dt className="inline font-semibold text-ink-900">Canali e tono: </dt><dd className="inline text-ink-700">{piano.intestazione.canaliETono}</dd></div>
            <div><dt className="inline font-semibold text-ink-900">Hashtag fissi: </dt><dd className="inline text-ink-700">{piano.intestazione.hashtag}</dd></div>
            <div><dt className="inline font-semibold text-ink-900">Prima di pubblicare: </dt><dd className="inline text-ink-700">{piano.intestazione.primaDiPubblicare}</dd></div>
          </dl>
        )}
        {/* La tabella scorre di lato nel suo riquadro, non la pagina: da tastiera ci si entra col Tab e si scorre con le
            frecce. Un riquadro che scorre deve poter prendere il fuoco (axe: scrollable-region-focusable), per questo il tabIndex. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-ink-100" tabIndex={0} role="region" aria-label={`Piano editoriale di ${o.nome_attivita}, scorre di lato`}>
          <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
            <thead className="bg-ink-50 text-ink-900">
              <tr>{['Data', 'Ora', 'Tipo', 'Tema', 'Stato', 'Didascalia proposta', 'Cosa riprendere', 'In città'].map((t) => <th key={t} scope="col" className="px-3 py-2 font-semibold">{t}</th>)}</tr>
            </thead>
            <tbody>
              {(piano?.contenuti ?? []).map((c, i) => (
                <tr key={`${c.data}-${i}`} className="border-t border-ink-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2">{giorno(c.data)}</td>
                  <td className="px-3 py-2">{c.ora}</td>
                  <td className="px-3 py-2">{c.tipo}</td>
                  <td className="px-3 py-2 font-medium text-ink-900">{c.tema}</td>
                  <td className="px-3 py-2">{c.stato}</td>
                  <td className="px-3 py-2 text-ink-700">{c.didascalia}</td>
                  <td className="px-3 py-2 text-ink-700">{c.cosaRiprendere}</td>
                  <td className="px-3 py-2 text-ink-700">{c.inCitta ?? '—'}{c.inCitta && c.fonteEvento ? <> · <a className="underline" href={c.fonteEvento} target="_blank" rel="noopener noreferrer nofollow">fonte</a></> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(piano?.note ?? []).length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-ink-600">{piano.note.map((n) => <li key={n}>{n}</li>)}</ul>}
      </section>

      <SezioneLavoro
        scelto={servizioScelto(d.servizi, 'sito_web')} servizio={ETICHETTE_SERVIZI.sito_web}
        id={`sito-${o.id}`} titolo="Bozza del sito" stato={o.sito_stato} errore={o.sito_errore} il={o.sito_il}
        pulsante="Chiedi la bozza del sito all’AD" chiedendo={chiedendo === 'chiedi-sito'} occupato={chiedendo !== null} chiedi={() => chiedi('chiedi-sito')}
      >
        {o.sito && (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-ink-700"><b>Sottotitolo:</b> {o.sito.sottotitolo} · <b>{o.sito.pagine.length} {o.sito.pagine.length === 1 ? 'pagina' : 'pagine'}</b> · bozza, non online: si pubblica solo dopo il sì del titolare e di SDG.</p>
            {o.sito.pagine.map((p) => (
              <div key={p.percorso} className="rounded-xl border border-ink-100 p-3">
                <p className="font-semibold text-ink-900">{p.titolo} <span className="font-normal text-ink-500">{p.percorso}</span></p>
                {p.sezioni.map((x, i) => <p key={`${x.titolo}-${i}`} className="mt-1 text-ink-700"><b>{x.titolo}:</b> {x.testo}</p>)}
              </div>
            ))}
            {o.sito.daConfermare.length > 0 && <div><p className="font-semibold text-ink-900">Da confermare col titolare</p><ul className="list-disc pl-5 text-ink-700">{o.sito.daConfermare.map((d) => <li key={d.voce}>{d.voce}: {d.perche}</li>)}</ul></div>}
            {o.sito.note.length > 0 && <ul className="list-disc pl-5 text-ink-600">{o.sito.note.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        )}
      </SezioneLavoro>

      <SezioneLavoro
        scelto={servizioScelto(d.servizi, 'analisi')} servizio={ETICHETTE_SERVIZI.analisi}
        id={`analisi-${o.id}`} titolo="Analisi di mercato all’avvio" stato={o.analisi_stato} errore={o.analisi_errore} il={o.analisi_il}
        pulsante="Chiedi l’analisi all’AD" chiedendo={chiedendo === 'chiedi-analisi'} occupato={chiedendo !== null} chiedi={() => chiedi('chiedi-analisi')}
      >
        {o.analisi && (
          <div className="mt-3 space-y-3 text-sm">
            <ul className="list-disc pl-5 text-ink-700">{o.analisi.sintesi.map((f) => <li key={f}>{f}</li>)}</ul>
            {o.analisi.parti.map((p) => (
              <div key={p.parte}>
                <p className="font-semibold text-ink-900">{p.titolo}</p>
                <ul className="list-disc pl-5 text-ink-700">{p.frasi.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            ))}
            <div><p className="font-semibold text-ink-900">Prime mosse</p><ul className="list-disc pl-5 text-ink-700">{o.analisi.primeMosse.map((m) => <li key={m.cosa}>{m.cosa} — {m.perche}</li>)}</ul></div>
          </div>
        )}
      </SezioneLavoro>
    </article>
  );
}

function SezioneLavoro({ scelto, servizio, id, titolo, stato, errore, il, pulsante, chiedendo, occupato, chiedi, children }: {
  scelto: boolean; servizio: string; id: string; titolo: string; stato: StatoPianoCompleto | undefined; errore: string | null | undefined; il: string | null | undefined;
  pulsante: string; chiedendo: boolean; occupato: boolean; chiedi: () => void; children: ReactNode;
}) {
  const s = stato ?? 'da_collegare';
  if (!scelto && s !== 'pronto') {
    return (
      <section className="border-t border-ink-100 p-4 sm:p-5" aria-labelledby={id}>
        <h3 id={id} className="font-serif text-lg font-bold text-ink-900">{titolo}</h3>
        <p className="mt-1 text-sm text-ink-600">«{servizio}» non è fra i servizi scelti: non si chiede all’AD.</p>
      </section>
    );
  }
  return (
    <section className="border-t border-ink-100 p-4 sm:p-5" aria-labelledby={id}>
      <h3 id={id} className="font-serif text-lg font-bold text-ink-900">{titolo}</h3>
      <p className="mt-1 text-sm text-ink-600">
        Stato: {STATO_LAVORO[s] ?? s}{errore ? ` — ${errore}` : ''}{s === 'pronto' && il ? ` (${quando(il)})` : ''}
      </p>
      {(s === 'da_collegare' || s === 'errore') && (
        <button type="button" onClick={chiedi} disabled={occupato} className="mt-2 rounded-lg border border-primary-600 px-3 py-1.5 text-sm font-semibold text-primary-700 disabled:opacity-60">
          {chiedendo ? 'Chiedo…' : pulsante}
        </button>
      )}
      {children}
    </section>
  );
}
