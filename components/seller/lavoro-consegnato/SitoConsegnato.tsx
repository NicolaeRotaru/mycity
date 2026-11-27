import type { LavoroConsegnato, Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { Button } from '@/components/ui/Button';
import { Elenco, IntestazioneConsegnato, LinkEsterno, SCHEDA, Sezione } from './comuni';

const NOME_FASCIA: Record<LavoroConsegnato['fascia'], string> = { base: 'Base', business: 'Business', premium: 'Premium' };

/**
 * 27/11/2026 — Nicola: «dentro la voce del menu sito web ci deve essere già il suo sito web versione business».
 * Quando il sito è online lo si vede qui dentro, dal vivo, e si può navigare. Il portiere (middleware.ts) lo lascia
 * entrare solo se il suo indirizzo è nell'elenco dei siti consegnati (lib/agenzia/lavoro-consegnato/siti.ts).
 */
export default function SitoConsegnato({ sito, fascia = 'premium' }: { sito: Sito; fascia?: LavoroConsegnato['fascia'] }) {
  const online = sito.stato === 'online';
  const nomeFascia = NOME_FASCIA[fascia];
  const LISTA_PER_FASCIA: Record<LavoroConsegnato['fascia'], string[]> = { base: [], business: sito.cosa_ha_di_business, premium: sito.cosa_ha_di_premium };
  const cosaHaInPiu = LISTA_PER_FASCIA[fascia];
  return (
    <div>
      <IntestazioneConsegnato aggiornato={sito.aggiornato_il} />
      <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm" aria-labelledby="sito-stato">
        <h2 id="sito-stato" className="text-xl font-bold text-ink-900">{sito.titolo}</h2>
        <p className="mt-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${online ? 'bg-olive-700 text-white' : 'bg-cream-200 text-ink-800'}`}>
            {online ? 'Online' : 'Da pubblicare'}
          </span>
        </p>
        {sito.indirizzo && (
          <div className="mt-3"><Button href={sito.indirizzo} target="_blank" rel="noopener noreferrer">Apri il sito</Button></div>
        )}
        {!sito.indirizzo && (
          <p className="mt-3 text-sm text-ink-700">Il sito è pronto: appena è pubblicato lo vedi qui, dal vivo.</p>
        )}
        {!online && sito.anteprima && (
          <img src={sito.anteprima} alt={`La prima pagina del sito: ${sito.titolo}`} width={1280} height={800} loading="lazy" className="mt-3 block h-auto w-full rounded-xl border border-cream-300" />
        )}
        {sito.codice && <p className="mt-3 text-sm text-ink-700">Il codice del sito: <LinkEsterno href={sito.codice}>{sito.codice}</LinkEsterno></p>}
      </section>

      {online && sito.indirizzo && (
        <section className={`mb-4 ${SCHEDA}`} aria-labelledby="sito-dal-vivo">
          <h2 id="sito-dal-vivo" className="text-sm font-bold text-ink-900">Il tuo sito, dal vivo</h2>
          <p className="mt-0.5 text-xs text-ink-500">Puoi navigarlo anche da qui. Per vederlo a tutto schermo premi «Apri il sito».</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-cream-300 bg-cream-50">
            <iframe
              src={sito.indirizzo}
              title={`Il sito: ${sito.titolo}`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              className="block h-[560px] w-full bg-white"
            />
          </div>
        </section>
      )}

      {sito.pagine.length > 0 && (
        <Sezione id="sito-pagine" titolo="Le pagine del sito">
          <ul className="space-y-2">
            {sito.pagine.map((p) => (
              <li key={p.percorso} className="rounded-xl border border-cream-200 p-3">
                <p className="font-semibold text-ink-900">{p.titolo} <span className="font-normal text-ink-500">{p.percorso}</span></p>
                <p className="mt-0.5">{p.cosa_contiene}</p>
              </li>
            ))}
          </ul>
        </Sezione>
      )}
      {cosaHaInPiu.length > 0 && (
        <Sezione id="sito-in-piu" titolo={`Cosa ha di ${nomeFascia}`}><Elenco voci={cosaHaInPiu} /></Sezione>
      )}
      {sito.da_confermare.length > 0 && (
        <Sezione id="sito-da-confermare" titolo="Da confermare">
          <ul className="list-disc space-y-1 pl-5">{sito.da_confermare.map((d) => <li key={d.voce}><b>{d.voce}</b>: {d.perche}</li>)}</ul>
        </Sezione>
      )}
      {sito.prossimi_passi.length > 0 && (
        <Sezione id="sito-passi" titolo="Prossimi passi">
          <ol className="list-decimal space-y-1 pl-5">{sito.prossimi_passi.map((p) => <li key={p.cosa}>{p.cosa} <span className="text-ink-500">({p.chi})</span></li>)}</ol>
        </Sezione>
      )}
    </div>
  );
}
