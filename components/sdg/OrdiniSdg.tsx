'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { FASCE, euro } from '@/lib/agenti/fasce';
import type { OrdineSdg, StatoPianoCompleto } from '@/lib/agenzia/ordine-sdg';

/**
 * GLI ORDINI DI SERVIZIO DI SDG — 27/11/2026 (migrazione 999c).
 *
 * Nicola: quando il titolare conferma, «in automatico deve arrivare l'ordine del servizio, quindi nella pagina
 * venditore di SDG … con su scritto tutti i dati, quindi che abbonamento ha scelto l'imprenditore, e tutto il piano
 * editoriale già fatto». Un ordine per attività: i dati del locale, l'abbonamento e il canone, la visita, l'agente,
 * e il piano del primo mese nel formato del Caffè di Piacenza (data, ora, tipo, tema, didascalia, cosa riprendere,
 * evento in città). La stessa pagina sta in /seller/ordini-sdg (la pagina venditore di SDG) e in /admin/ordini-sdg:
 * oggi la apre Nicola, domani l'account di SDG. Chi altro prova vede il rifiuto della rotta (app/api/sdg/ordini).
 */
type Ordine = OrdineSdg & { visita: string };

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

  async function chiediPiano(o: Ordine) {
    setChiedendo(o.id);
    try {
      const r = await fetch('/api/sdg/ordini', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: o.id, azione: 'chiedi-piano' }) });
      const corpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: { message?: string } } | null;
      if (!r.ok || !corpo?.ok) throw new Error(corpo?.error?.message ?? 'Non sono riuscito a chiederlo');
      toast.success('Piano completo chiesto all’AD: arriva in qualche minuto');
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
        {(data ?? []).map((o) => <SchedaOrdine key={o.id} o={o} chiedendo={chiedendo === o.id} chiediPiano={() => chiediPiano(o)} />)}
      </div>
    </div>
  );
}

function SchedaOrdine({ o, chiedendo, chiediPiano }: { o: Ordine; chiedendo: boolean; chiediPiano: () => void }) {
  const fascia = FASCE[o.fascia];
  const d = o.dati_attivita ?? ({} as Ordine['dati_attivita']);
  const s = d.dallaScheda;
  const piano = o.piano;
  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm" aria-labelledby={`ordine-${o.id}`}>
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
        {(o.piano_completo_stato === 'da_collegare' || o.piano_completo_stato === 'errore') && (
          <button type="button" onClick={chiediPiano} disabled={chiedendo} className="mt-2 rounded-lg border border-primary-600 px-3 py-1.5 text-sm font-semibold text-primary-700 disabled:opacity-60">
            {chiedendo ? 'Chiedo…' : 'Chiedi il piano completo all’AD'}
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
        {/* La tabella scorre di lato nel suo riquadro, non la pagina: da tastiera ci si entra col Tab e si scorre con le frecce. */}
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
    </article>
  );
}
