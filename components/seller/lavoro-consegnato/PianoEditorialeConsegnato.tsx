'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { Social } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { Elenco, IntestazioneConsegnato, LinkEsterno, SCHEDA, Sezione, giornoCorto } from './comuni';

/**
 * IL PIANO SOCIAL NELLA FORMA STANDARD — nato per SDG il 27/11/2026, standard per ogni cliente dal 28/11/2026.
 * Nicola, 28/11: «la gestione dei social dentro SDG è fatta veramente molto bene: usala come standard». La stessa
 * pagina disegna il piano Premium di SDG e quello di ogni cliente (lib/agenzia/social-standard.ts): per il cliente
 * cambiano l'intestazione (la sua fascia, «bozza») e una riga d'avviso sullo stato del piano.
 */

const STRATO: Record<string, string> = { base: 'Base', business: 'Business', premium: 'Premium' };

/** Il lunedì della settimana di un giorno «AAAA-MM-GG», come «2026-11-30» (chiave per raggruppare). */
function lunediDi(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const nomeDelSito = (f: string) => {
  try {
    return new URL(f).hostname.replace(/^www\./, '');
  } catch {
    return 'fonte';
  }
};

type Props = { social: Social; intestazione?: ReactNode; avviso?: string | null };

export default function PianoEditorialeConsegnato({ social, intestazione, avviso }: Props) {
  const [canale, setCanale] = useState('');
  const nomiCanali = useMemo(() => Array.from(new Set(social.calendario.flatMap((c) => c.canale.split('+').map((s) => s.trim())))), [social.calendario]);
  const visibili = useMemo(
    () => social.calendario.filter((c) => !canale || c.canale.split('+').map((s) => s.trim()).includes(canale)).sort((a, b) => (a.giorno + a.ora).localeCompare(b.giorno + b.ora)),
    [social.calendario, canale],
  );
  const settimane = useMemo(() => {
    const m = new Map<string, typeof visibili>();
    for (const c of visibili) { const k = lunediDi(c.giorno); m.set(k, [...(m.get(k) ?? []), c]); }
    return Array.from(m.entries());
  }, [visibili]);
  // Lo strato si scrive solo se il piano ne ha più d'uno: in un piano Base direbbe sempre «Base».
  const piuStrati = useMemo(() => new Set(social.calendario.map((c) => c.strato)).size > 1, [social.calendario]);

  return (
    <div>
      {intestazione === undefined ? <IntestazioneConsegnato aggiornato={social.aggiornato_il} /> : intestazione}
      <Sezione id="piano-obiettivo" titolo={social.titolo}>
        {avviso && <p className="mb-f1 text-ink-600">{avviso}</p>}
        <p><b>Obiettivo.</b> {social.obiettivo}</p>
        <p className="mt-f1"><b>A chi parliamo.</b> {social.a_chi_parliamo}</p>
        {social.tono && <p className="mt-f1"><b>Canali e tono.</b> {social.tono}</p>}
      </Sezione>

      {social.da_dove_partiamo.length > 0 && (
        <Sezione id="piano-partenza" titolo="Da dove partiamo">
          <p className="mb-f1 text-ink-600">Dall’analisi della tua attività: è il punto da cui cresce il piano.</p>
          <Elenco voci={social.da_dove_partiamo} />
        </Sezione>
      )}

      {social.canali.length > 0 && (
        <Sezione id="piano-canali" titolo="I canali">
          <ul className="space-y-2">
            {social.canali.map((c) => (
              <li key={c.nome} className="rounded-xl border border-cream-200 p-3">
                <p className="font-semibold text-ink-900">
                  {c.nome} {c.account && <span className="font-normal text-ink-600">{c.account}</span>}
                  {c.da_aprire && <span className="ml-2 rounded-full bg-cream-200 px-2 py-0.5 text-[11px] font-bold text-ink-800">da aprire</span>}
                </p>
                <p className="mt-0.5">{c.ruolo}</p>
              </li>
            ))}
          </ul>
        </Sezione>
      )}

      {social.pilastri.length > 0 && (
        <Sezione id="piano-pilastri" titolo="I pilastri: di cosa parliamo">
          <ul className="space-y-2">
            {social.pilastri.map((p) => (
              <li key={p.nome}><b>{p.nome} · {p.percentuale}%</b> — {p.descrizione}</li>
            ))}
          </ul>
        </Sezione>
      )}

      {social.quantita.length > 0 && (
        <Sezione id="piano-quantita" titolo="Quanto esce nel mese">
          <ul className="grid gap-2 sm:grid-cols-2">
            {social.quantita.map((q) => <li key={q.voce} className="rounded-xl border border-cream-200 p-3"><span className="text-lg font-bold text-ink-900">{q.quanti}</span> <span>{q.voce}</span></li>)}
          </ul>
        </Sezione>
      )}

      <section className={`mb-4 ${SCHEDA}`} aria-labelledby="piano-calendario">
        <h2 id="piano-calendario" className="text-xl font-bold text-ink-900">Il calendario</h2>
        {nomiCanali.length > 1 && (
          <div className="mt-2">
            <label htmlFor="piano-filtro" className="mr-2 text-sm text-ink-700">Canale</label>
            <select id="piano-filtro" value={canale} onChange={(e) => setCanale(e.target.value)} className="min-h-[44px] rounded-xl border border-cream-300 bg-white px-3 text-sm">
              <option value="">Tutti</option>
              {nomiCanali.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        {settimane.length === 0 && <p className="mt-3 text-sm text-ink-500">Nessun contenuto in calendario.</p>}
        {settimane.map(([lunedi, voci]) => (
          <div key={lunedi} className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-600">Settimana dal {giornoCorto(lunedi)}</h3>
            <ul className="mt-2 space-y-2">
              {voci.map((c) => (
                <li key={`${c.giorno}-${c.ora}-${c.canale}-${c.titolo}`} className="rounded-xl border border-cream-200 p-3 text-sm">
                  <p className="font-semibold text-ink-900">{giornoCorto(c.giorno)} · {c.ora} · {c.canale}</p>
                  <p className="mt-1 text-ink-800">{c.titolo}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className="rounded-full bg-cream-100 px-2 py-0.5 text-ink-800">{c.formato}</span>
                    <span className="rounded-full bg-cream-100 px-2 py-0.5 text-ink-800">{c.pilastro}</span>
                    {piuStrati && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-primary-800">Strato {STRATO[c.strato]}</span>}
                    <span className="rounded-full bg-cream-200 px-2 py-0.5 text-ink-800">{c.stato === 'da_approvare' ? 'Da approvare' : c.stato.replace(/_/g, ' ')}</span>
                  </p>
                  {c.in_citta && (
                    <p className="mt-1 text-xs text-ink-600">
                      In città: {c.in_citta}
                      {c.fonte_evento && <> · <LinkEsterno href={c.fonte_evento}>{nomeDelSito(c.fonte_evento)}</LinkEsterno></>}
                    </p>
                  )}
                  <details className="mt-f1">
                    <summary className="cursor-pointer text-sm font-semibold text-primary-700">Leggi la didascalia</summary>
                    <p className="mt-1 whitespace-pre-line text-ink-700">{c.testo}</p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {social.extra_premium.length > 0 && (
        <Sezione id="piano-extra" titolo={social.titolo_extra || 'Extra Premium'}>
          <ul className="space-y-2">
            {social.extra_premium.map((e) => (
              <li key={e.voce}><b>{e.voce}</b> — {e.cosa}{e.costo_fuori_canone && <span className="text-ink-600"> (fuori canone: {e.costo_fuori_canone})</span>}</li>
            ))}
          </ul>
        </Sezione>
      )}
      {social.misure.length > 0 && (
        <Sezione id="piano-misure" titolo="Come misuriamo">
          <ul className="space-y-2">{social.misure.map((m) => <li key={m.kpi}><b>{m.kpi}</b>: {m.obiettivo}. <span className="text-ink-600">{m.come_si_misura}</span></li>)}</ul>
        </Sezione>
      )}
      {social.regole.length > 0 && <Sezione id="piano-regole" titolo="Le regole"><Elenco voci={social.regole} /></Sezione>}
    </div>
  );
}
