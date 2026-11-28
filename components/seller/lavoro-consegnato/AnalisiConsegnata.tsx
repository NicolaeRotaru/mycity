import type { ReactNode } from 'react';
import type { Analisi } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { Elenco, IntestazioneConsegnato, LinkEsterno, SCHEDA, Sezione } from './comuni';

/**
 * L'ANALISI NELLA FORMA STANDARD — nata per SDG il 27/11/2026, standard per ogni cliente dal 28/11/2026.
 * Nicola, 28/11: «l'analisi di mercato è molto molto bella: usala come standard per tutti». La stessa pagina disegna
 * l'analisi di SDG e quella di ogni cliente (lib/agenzia/analisi-standard.ts): per il cliente cambiano l'intestazione
 * (la sua fascia, «bozza»), una riga sul ritmo, cosa comprende l'abbonamento e le cose da confermare alla visita.
 */

const NOME_FASCIA: Record<string, string> = { base: 'Base', business: 'Business', premium: 'Premium' };

type Props = { analisi: Analisi; intestazione?: ReactNode; avviso?: string | null };

export default function AnalisiConsegnata({ analisi, intestazione, avviso }: Props) {
  const swot: [string, string[]][] = [
    ['Forze', analisi.swot.forze], ['Debolezze', analisi.swot.debolezze],
    ['Opportunità', analisi.swot.opportunita], ['Minacce', analisi.swot.minacce],
  ];
  // I quattro riquadri solo se c'è qualcosa: un'analisi di prima dello standard non ne ha, e mostrerebbe quattro vuoti.
  const conSwot = swot.some(([, voci]) => voci.length > 0);
  return (
    <div>
      {intestazione === undefined ? <IntestazioneConsegnato aggiornato={analisi.aggiornata_il} /> : intestazione}
      <Sezione id="an-sintesi" titolo={analisi.titolo}>
        {avviso && <p className="mb-f1 text-ink-600">{avviso}</p>}
        <p className="whitespace-pre-line">{analisi.sintesi}</p>
      </Sezione>

      {analisi.numeri_chiave.length > 0 && (
        <Sezione id="an-numeri" titolo="I numeri chiave">
          <ul className="grid gap-2 sm:grid-cols-2">
            {analisi.numeri_chiave.map((n, i) => (
              <li key={`${i}-${n.voce}`} className="rounded-xl border border-cream-200 p-3">
                <p className="text-lg font-bold text-ink-900">{n.valore}</p>
                <p>{n.voce}{n.da_confermare && <span className="ml-2 rounded-full bg-cream-200 px-2 py-0.5 text-[11px] font-bold text-ink-800">da confermare</span>}</p>
                {n.fonte && <p className="mt-1 text-xs"><LinkEsterno href={n.fonte}>Fonte</LinkEsterno></p>}
              </li>
            ))}
          </ul>
        </Sezione>
      )}

      {analisi.mercato.length > 0 && (
        <Sezione id="an-mercato" titolo="Il mercato">
          <div className="space-y-3">
            {analisi.mercato.map((m) => (
              <div key={m.titolo}>
                <p className="font-semibold text-ink-900">{m.titolo}</p>
                <p>{m.testo}</p>
                {m.fonti.length > 0 && <p className="mt-1 text-xs">{m.fonti.map((f, i) => <span key={f}>{i > 0 && ' · '}<LinkEsterno href={f}>Fonte {i + 1}</LinkEsterno></span>)}</p>}
              </div>
            ))}
          </div>
        </Sezione>
      )}

      {analisi.concorrenti.length > 0 && (
        <Sezione id="an-concorrenti" titolo="I concorrenti">
          <ul className="space-y-3">
            {analisi.concorrenti.map((c, i) => (
              <li key={`${i}-${c.nome}`} className="rounded-xl border border-cream-200 p-3">
                <p className="font-semibold text-ink-900">{c.nome}{c.tipo && <span className="font-normal text-ink-500"> · {c.tipo}</span>}</p>
                <p className="mt-1">{c.cosa_fanno}</p>
                {c.prezzo_indicativo && <p className="mt-1"><b>Prezzo:</b> {c.prezzo_indicativo}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div><p className="text-xs font-bold text-olive-700">Punti forti</p><Elenco voci={c.punti_forti} /></div>
                  <div><p className="text-xs font-bold text-primary-700">Punti deboli</p><Elenco voci={c.punti_deboli} /></div>
                </div>
                {c.fonte && <p className="mt-2 text-xs"><LinkEsterno href={c.fonte}>Fonte</LinkEsterno></p>}
              </li>
            ))}
          </ul>
        </Sezione>
      )}

      {conSwot && <section className={`mb-4 ${SCHEDA}`} aria-labelledby="an-swot">
        <h2 id="an-swot" className="text-xl font-bold text-ink-900">Forze, debolezze, opportunità, minacce</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {swot.map(([nome, voci]) => (
            <div key={nome} className="rounded-xl border border-cream-200 bg-cream-50 p-3 text-sm text-ink-700">
              <h3 className="mb-1 font-bold text-ink-900">{nome}</h3>
              <Elenco voci={voci} />
            </div>
          ))}
        </div>
      </section>}

      {analisi.clienti_tipo.length > 0 && (
        <Sezione id="an-clienti" titolo="I clienti tipo">
          <ul className="space-y-2">
            {analisi.clienti_tipo.map((c, i) => (
              <li key={`${i}-${c.nome}`} className="rounded-xl border border-cream-200 p-3">
                <p className="font-semibold text-ink-900">{c.nome}{c.abbonamento_adatto && <span className="ml-2 rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-bold">{NOME_FASCIA[c.abbonamento_adatto]}</span>}</p>
                <p className="mt-1">{c.bisogno}</p>
                {c.perche && <p className="mt-1 text-ink-600">{c.perche}</p>}
              </li>
            ))}
          </ul>
        </Sezione>
      )}

      {analisi.prezzi.length > 0 && (
        <Sezione id="an-prezzi" titolo="I prezzi a confronto">
          <ul className="space-y-2">{analisi.prezzi.map((p) => <li key={p.voce}><b>{p.voce}</b> — {p.confronto}</li>)}</ul>
        </Sezione>
      )}

      {analisi.presenza_online_sdg.length > 0 && (
        <Sezione id="an-presenza" titolo={analisi.titolo_presenza || 'La presenza online di SDG'}>
          <ul className="space-y-2">
            {analisi.presenza_online_sdg.map((p) => (
              <li key={p.canale}><b>{p.canale}</b>: {p.stato}{p.indirizzo && <> · <LinkEsterno href={p.indirizzo}>apri</LinkEsterno></>}{p.nota && <span className="text-ink-600"> — {p.nota}</span>}</li>
            ))}
          </ul>
        </Sezione>
      )}

      {analisi.raccomandazioni.length > 0 && (
        <Sezione id="an-raccomandazioni" titolo="Cosa fare, in ordine">
          <ol className="space-y-3">
            {[...analisi.raccomandazioni].sort((a, b) => a.priorita - b.priorita).map((r) => (
              <li key={`${r.priorita}-${r.cosa}`} className="flex gap-3 rounded-xl border border-cream-200 p-3">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-700 text-sm font-bold text-white">{r.priorita}</span>
                <div>
                  <p className="font-semibold text-ink-900"><span className="sr-only">Priorità {r.priorita}: </span>{r.cosa}</p>
                  <p className="mt-1">{r.perche}</p>
                  {(r.quando || r.costo) && <p className="mt-1 text-xs text-ink-600">{r.quando && <>Quando: {r.quando}</>}{r.quando && r.costo && ' · '}{r.costo && <>Costo: {r.costo}</>}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Sezione>
      )}

      {analisi.da_confermare.length > 0 && (
        <Sezione id="an-da-confermare" titolo="Da confermare alla visita"><Elenco voci={analisi.da_confermare} /></Sezione>
      )}

      {analisi.compreso && analisi.compreso.voci.length > 0 && (
        <Sezione id="an-compreso" titolo={analisi.compreso.titolo}><Elenco voci={analisi.compreso.voci} /></Sezione>
      )}

      {analisi.fonti.length > 0 && (
        <Sezione id="an-fonti" titolo="Le fonti">
          <ul className="list-disc space-y-1 pl-5">{analisi.fonti.map((f) => <li key={f}><LinkEsterno href={f}>{f}</LinkEsterno></li>)}</ul>
        </Sezione>
      )}
    </div>
  );
}
