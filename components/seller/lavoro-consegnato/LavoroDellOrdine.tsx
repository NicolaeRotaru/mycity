import { FASCE } from '@/lib/agenti/fasce';
import type { LavoroDellOrdine } from '@/lib/agenzia/lavoro-dell-ordine';
import type { ParteConsegnata } from '@/lib/agenzia/lavoro-consegnato/quale-parte';
import { PAGINE_PER_FASCIA } from '@/lib/agenzia/sito-dell-ordine-ad';
import { Elenco, LinkEsterno, SCHEDA, Sezione, giornoCorto } from './comuni';

/**
 * IL LAVORO NATO CON L'ORDINE, NELLA ZONA «SERVIZI» DEL TITOLARE — 28/11/2026.
 *
 * Nicola, 28/11: all'accettazione nascono in automatico, in base all'abbonamento, il sito, il piano editoriale e
 * l'analisi. Il titolare li vede qui, nelle tre voci Sito web, Gestione social e Analisi del business, sempre come
 * BOZZA: «la confermiamo insieme alla visita». Il sito non è online: va online solo dopo il sì del titolare e di SDG.
 * Quello che non è ancora pronto dice «in preparazione»: mai un errore tecnico, mai una pagina vuota.
 */

const nomeDelSito = (f: string) => {
  try {
    return new URL(f).hostname;
  } catch {
    return 'fonte';
  }
};

export const SCRITTA_BOZZA = 'Bozza, la confermiamo insieme alla visita';

function Intestazione({ ordine }: { ordine: LavoroDellOrdine }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[11px] font-bold text-ink-900">{FASCE[ordine.fascia]?.nome ?? ordine.fascia} · {SCRITTA_BOZZA}</span>
    </p>
  );
}

/** Le due attese, dette al titolare senza errori tecnici (AD, 28/11 01:15). */
export const FRASE_IN_PREPARAZIONE = 'In preparazione, pronto entro poche ore.';
export const FRASE_LO_STIAMO_PREPARANDO = 'Lo stiamo preparando: appena è pronto lo trovi qui.';
const attesa = (stato: LavoroDellOrdine['sito']['stato']) => (stato === 'in_preparazione' ? FRASE_IN_PREPARAZIONE : FRASE_LO_STIAMO_PREPARANDO);

function InPreparazione({ titolo, testo }: { titolo: string; testo: string }) {
  return (
    <section className={`mb-4 ${SCHEDA}`} aria-live="polite">
      <h2 className="text-xl font-bold text-ink-900">{titolo}</h2>
      <p className="mt-2 text-sm text-ink-700">{testo}</p>
    </section>
  );
}

export default function LavoroDellOrdineDelTitolare({ parte, ordine }: { parte: ParteConsegnata; ordine: LavoroDellOrdine }) {
  const fascia = FASCE[ordine.fascia]?.nome ?? ordine.fascia;
  return (
    <div>
      <Intestazione ordine={ordine} />
      {parte === 'sito' && (ordine.sito.bozza ? <BozzaDelSito ordine={ordine} /> : (
        <InPreparazione
          titolo="La bozza del tuo sito"
          testo={`${attesa(ordine.sito.stato)} Col ${fascia} il sito ha ${PAGINE_PER_FASCIA[ordine.fascia] === 1 ? 'una pagina' : `${PAGINE_PER_FASCIA[ordine.fascia]} pagine`}. La guardiamo insieme alla visita, e va online solo dopo il tuo sì.`}
        />
      ))}
      {parte === 'social' && <PianoDellOrdine ordine={ordine} />}
      {parte === 'analisi' && (ordine.analisi.analisi ? <AnalisiDellOrdine ordine={ordine} /> : (
        <InPreparazione titolo="La tua analisi del business" testo={`${attesa(ordine.analisi.stato)} È il rapporto sulla tua attività, coi soli dati pubblici: lo leggiamo insieme alla visita.`} />
      ))}
    </div>
  );
}

function BozzaDelSito({ ordine }: { ordine: LavoroDellOrdine }) {
  const b = ordine.sito.bozza!;
  return (
    <>
      <section className={`mb-4 ${SCHEDA}`} aria-labelledby="bozza-sito">
        <h2 id="bozza-sito" className="text-xl font-bold text-ink-900">{ordine.nomeAttivita}</h2>
        <p className="mt-1 text-sm text-ink-700">{b.sottotitolo}</p>
        <p className="mt-3"><span className="rounded-full bg-cream-200 px-2.5 py-0.5 text-[11px] font-bold text-ink-800">Non è online</span></p>
        <p className="mt-2 text-sm text-ink-700">Va online solo dopo il tuo sì e quello di SDG. Ogni testo è una proposta: lo cambiamo come vuoi tu.</p>
      </section>
      {b.pagine.map((p, i) => (
        <Sezione key={p.percorso} id={`bozza-pagina-${i}`} titolo={`Pagina ${i + 1}: ${p.titolo}`}>
          <div className="space-y-3">
            {p.sezioni.map((s, j) => (
              <div key={`${s.titolo}-${j}`}>
                <h3 className="font-semibold text-ink-900">{s.titolo} <span className="ml-1 rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">da confermare</span></h3>
                <p className="mt-1">{s.testo}</p>
              </div>
            ))}
          </div>
        </Sezione>
      ))}
      {b.daConfermare.length > 0 && (
        <Sezione id="bozza-da-confermare" titolo="Da confermare alla visita">
          <Elenco voci={b.daConfermare.map((d) => `${d.voce}: ${d.perche}`)} />
        </Sezione>
      )}
    </>
  );
}

function PianoDellOrdine({ ordine }: { ordine: LavoroDellOrdine }) {
  const p = ordine.piano.piano;
  return (
    <>
      <section className={`mb-4 ${SCHEDA}`} aria-labelledby="piano-ordine">
        <h2 id="piano-ordine" className="text-xl font-bold text-ink-900">Il piano editoriale, {p?.periodo?.titolo ?? 'primo mese'}</h2>
        <p className="mt-1 text-sm text-ink-600">{ordine.piano.stato === 'pronto' ? 'Versione completa' : `Prima versione. Quella completa: ${attesa(ordine.piano.stato).toLowerCase()}`} · {p?.contenuti?.length ?? 0} contenuti</p>
        {p?.intestazione && (
          <dl className="mt-3 grid gap-1 text-sm text-ink-700">
            <div><dt className="inline font-semibold text-ink-900">Canali e tono: </dt><dd className="inline">{p.intestazione.canaliETono}</dd></div>
            <div><dt className="inline font-semibold text-ink-900">Prima di pubblicare: </dt><dd className="inline">{p.intestazione.primaDiPubblicare}</dd></div>
          </dl>
        )}
      </section>
      <ul className="space-y-3">
        {(p?.contenuti ?? []).map((c, i) => (
          <li key={`${c.data}-${i}`} className={SCHEDA}>
            <p className="text-sm font-semibold text-ink-900">{giornoCorto(c.data)} · {c.ora} · {c.tipo}</p>
            <p className="mt-1 font-semibold text-ink-900">{c.tema}</p>
            <p className="mt-1 text-sm text-ink-700">{c.didascalia}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function AnalisiDellOrdine({ ordine }: { ordine: LavoroDellOrdine }) {
  const a = ordine.analisi.analisi!;
  return (
    <>
      <Sezione id="analisi-sintesi" titolo="In breve">
        <p className="mb-2 text-ink-600">{a.ritmo} Questo è il rapporto dell’avvio, fatto coi soli dati pubblici.</p>
        <Elenco voci={a.sintesi} />
      </Sezione>
      {a.parti.map((p) => (
        <Sezione key={p.parte} id={`analisi-${p.parte}`} titolo={p.titolo}>
          <Elenco voci={p.frasi} />
          {p.fonti.length > 0 && (
            <p className="mt-2 text-xs text-ink-600">Fonti: {p.fonti.map((f, i) => <span key={f}>{i > 0 ? ' · ' : ''}<LinkEsterno href={f}>{nomeDelSito(f)}</LinkEsterno></span>)}</p>
          )}
        </Sezione>
      ))}
      <Sezione id="analisi-mosse" titolo="Le prime mosse, nei primi 30 giorni">
        <Elenco voci={a.primeMosse.map((m) => `${m.cosa} — ${m.perche}`)} />
      </Sezione>
      {a.daConfermare.length > 0 && (
        <Sezione id="analisi-da-confermare" titolo="Da confermare alla visita">
          <Elenco voci={a.daConfermare} />
        </Sezione>
      )}
    </>
  );
}
