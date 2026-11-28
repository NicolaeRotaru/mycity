import { Camera, CalendarDays, Check, Film, Globe, MapPin, Sparkles, TrendingUp } from 'lucide-react';
import type { ServizioAgenzia } from '@/lib/agenzia/preventivo';
import type { TipoAttivita } from '@/lib/agenzia/tipi-attivita';
import type { SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import { sezioniDellaBozza, type BozzaSitoAd } from '@/lib/agenzia/bozza-sito-ad';
import {
  bozzaSito,
  FORMATI_FOTO,
  FORMATI_VIDEO,
  LAVORI_DI_EDITING,
  pianoEditoriale,
  schedaGoogle,
  type FormatoMedia,
} from '@/lib/agenzia/contenuti-servizi';
import { firmaDi, ordineDiAccensione, tokenCss } from '@/lib/armonia';
import TramaNascosta from '@/components/armonia/TramaNascosta';
import LunaDiOggi from '@/components/armonia/LunaDiOggi';
import SigilloNascosto from '@/components/armonia/SigilloNascosto';

/**
 * COSA RICEVI — l'anteprima di un servizio, dentro la pagina del servizio (Nicola, 23/11/2026).
 * Sito → la bozza del sito col nome del cliente; social → il piano editoriale del mese con esempi
 * e, dal 24/11/2026, come apparirà la scheda su Google Maps, che è dentro la gestione social;
 * foto e video → i formati e i lavori di editing.
 * I contenuti li calcola `lib/agenzia/contenuti-servizi.ts`: qui si disegna soltanto.
 */

/**
 * `scheda`: la scheda del locale mandata da n8n (24/11/2026). Senza, la bozza e il piano restano generici.
 * `bozzaAd`: la bozza del sito scritta dall'AD (24/11/2026). Se c'è, i testi del sito sono i suoi.
 */
type Props = { id: ServizioAgenzia; nome: string; tipo: TipoAttivita; giorno: string; scheda?: SchedaCliente | null; bozzaAd?: BozzaSitoAd | null };

export default function AnteprimaServizio({ id, nome, tipo, giorno, scheda, bozzaAd }: Props) {
  if (id === 'sito_web') return <BozzaDelSito nome={nome} tipo={tipo} giorno={giorno} scheda={scheda} bozzaAd={bozzaAd} />;
  if (id === 'analisi') return <CosaContieneLAnalisi />;
  if (id === 'social') {
    return (
      <>
        <PianoDelMese nome={nome} tipo={tipo} giorno={giorno} scheda={scheda} />
        <SchedaSuMaps nome={nome} tipo={tipo} />
      </>
    );
  }
  return <FormatiFotoVideo />;
}

function Riquadro({ icona: Icona, titolo, nota, children }: { icona: typeof Globe; titolo: string; nota: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 rounded-xl border border-cream-200 bg-cream-50 p-3 sm:p-4 print:break-inside-avoid" aria-label={titolo}>
      <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-900">
        <Icona size={16} className="text-primary-700" aria-hidden /> {titolo}
      </h3>
      <p className="mt-0.5 text-xs text-ink-500">{nota}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DaConfermare({ testo = 'da confermare' }: { testo?: string }) {
  return <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[10px] font-semibold text-amber-800">{testo}</span>;
}

function BozzaDelSito({ nome, tipo, giorno, scheda, bozzaAd }: { nome: string; tipo: TipoAttivita; giorno: string; scheda?: SchedaCliente | null; bozzaAd?: BozzaSitoAd | null }) {
  const fattaCoiDati = bozzaSito(nome, tipo, scheda);
  // La bozza dell'AD prende il posto dei testi; indirizzo, nome e pulsante restano quelli calcolati.
  const b = bozzaAd
    ? { ...fattaCoiDati, sottotitolo: bozzaAd.sottotitolo ?? fattaCoiDati.sottotitolo, sezioni: sezioniDellaBozza(bozzaAd) }
    : fattaCoiDati;
  // ARMONIA NASCOSTA (Nicola, 28/11/2026): ogni sito nasce dalla firma della sua attività. La data è
  // il giorno del preventivo finché non conosciamo quella d'apertura. Vedi lib/armonia e la skill «armonia».
  const firma = firmaDi({ nome: b.nome, data: giorno });
  const accensione = ordineDiAccensione(firma.pianeta, b.sezioni.length);
  return (
    <Riquadro
      icona={Globe}
      titolo="La bozza del tuo sito"
      nota={bozzaAd
        ? 'I testi li abbiamo scritti per te con quello che sappiamo del tuo locale. Ogni testo è da confermare: li correggi tu, prima che il sito vada online.'
        : 'Una prima bozza fatta con i tuoi dati: testi e foto li completiamo insieme.'}
    >
      <div className="overflow-hidden rounded-lg border border-cream-300 bg-white shadow-sm" style={tokenCss(firma)} data-armonia-numero={firma.numero}>
        {/* La barra del browser: l'indirizzo è un suggerimento, da verificare se è libero. */}
        <div className="flex items-center gap-2 border-b border-cream-200 bg-cream-100 px-3 py-1.5">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
          </span>
          <span className="flex-1 truncate rounded bg-white px-2 py-0.5 font-mono text-[11px] text-ink-600">{b.indirizzo}</span>
        </div>
        <div className="relative overflow-hidden bg-ink-900 px-4 py-6 text-center text-white">
          <TramaNascosta firma={firma} className="text-cream-100" />
          <div className="relative">
            <p className="font-serif text-xl font-bold">{b.nome}</p>
            <p className="mt-1 text-xs text-cream-100">{b.sottotitolo}</p>
            <span className="mt-3 inline-block bg-primary-700 px-3 py-1 text-xs font-bold" style={{ borderRadius: firma.raggio }}>{b.invito}</span>
          </div>
        </div>
        {/* Le sezioni in sezione aurea (1,618 a 1) e accese nell'ordine del quadrato magico del pianeta. */}
        <div className="grid gap-px bg-cream-200 sm:grid-cols-[1.618fr_1fr]">
          {b.sezioni.map((s, i) => (
            <div key={s.titolo} className="armonia-entra bg-white p-3" style={{ animationDelay: `${(accensione[i] ?? i) * 111}ms` }}>
              <p className="text-xs font-bold text-ink-900">{s.titolo}{s.daConfermare && <DaConfermare testo={bozzaAd ? 'da confermare dal titolare' : undefined} />}</p>
              <p className="mt-0.5 text-xs text-ink-600">{s.testo}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-cream-200 bg-cream-50 px-3 py-1.5 text-[10px] text-ink-500">
          <span className="truncate">{b.nome}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <SigilloNascosto firma={firma} dimensione={10} />
            <LunaDiOggi dimensione={10} />
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        {b.indirizzoEsistente
          ? `${b.indirizzo} è l’indirizzo del sito che hai già: lo teniamo, e il sito nuovo va lì.`
          : `L’indirizzo ${b.indirizzo} è un suggerimento: prima di comprarlo verifichiamo che sia libero.`}
        {bozzaAd
          ? ' Ogni testo lo confermi tu: niente va online senza il tuo sì.'
          : b.sezioni.some((s) => s.dalLocale) && ' I dati del tuo locale li abbiamo trovati in rete: quelli «da confermare» li controlli tu.'}
      </p>
    </Riquadro>
  );
}

const giornoCorto = (data: string) =>
  new Date(`${data}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

function PianoDelMese({ nome, tipo, giorno, scheda }: { nome: string; tipo: TipoAttivita; giorno: string; scheda?: SchedaCliente | null }) {
  const piano = pianoEditoriale(nome, tipo, giorno, scheda);
  return (
    <Riquadro
      icona={CalendarDays}
      titolo={`Il piano editoriale di ${piano.mese}`}
      nota={`${piano.post.length} post, 3 a settimana. Sono esempi: i post veri li prepariamo noi con le foto della tua vetrina, e tu li approvi prima che escano.`}
    >
      <ol className="divide-y divide-cream-200 rounded-lg border border-cream-200 bg-white">
        {piano.post.map((p) => (
          <li key={p.data} className="flex gap-3 px-3 py-2">
            <span className="w-14 shrink-0 text-xs font-semibold capitalize text-ink-900">{giornoCorto(p.data)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <span className="rounded bg-cream-100 px-1.5 py-0.5 font-semibold text-primary-700">{p.formato}</span>{' '}
                <span className="font-semibold text-ink-900">{p.tema}</span>
              </p>
              <p className="mt-0.5 text-xs italic text-ink-600">«{p.esempio}»</p>
            </div>
          </li>
        ))}
      </ol>
    </Riquadro>
  );
}

function TabellaFormati({ formati }: { formati: FormatoMedia[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {formati.map((f) => (
        <li key={f.nome} className="rounded-lg border border-cream-200 bg-white p-3">
          <p className="text-xs font-bold text-ink-900">{f.nome}</p>
          <p className="text-[11px] font-semibold text-primary-700">{f.misura}</p>
          <p className="mt-1 text-xs text-ink-600">{f.cosa}</p>
          <p className="mt-1 text-[11px] text-ink-500">Per: {f.dove}</p>
        </li>
      ))}
    </ul>
  );
}

function FormatiFotoVideo() {
  return (
    <Riquadro icona={Sparkles} titolo="I formati che ricevi" nota="Quanti scatti e quanti video ogni mese lo dice il tuo abbonamento: Base, Business o Premium.">
      <h4 className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700">
        <Camera size={14} aria-hidden /> Foto
      </h4>
      <TabellaFormati formati={FORMATI_FOTO} />
      <h4 className="mb-2 mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700">
        <Film size={14} aria-hidden /> Video
      </h4>
      <TabellaFormati formati={FORMATI_VIDEO} />
      <h4 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-ink-700">Editing compreso</h4>
      <ul className="list-disc pl-4 text-xs text-ink-600">
        {LAVORI_DI_EDITING.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </Riquadro>
  );
}

function SchedaSuMaps({ nome, tipo }: { nome: string; tipo: TipoAttivita }) {
  const sc = schedaGoogle(nome, tipo);
  return (
    <Riquadro icona={MapPin} titolo="La tua scheda su Google Maps" nota="Come ti troverà chi cerca vicino a te: un esempio fatto con i tuoi dati.">
      <div className="rounded-lg border border-cream-300 bg-white p-3 shadow-sm">
        <p className="font-semibold text-ink-900">{sc.nome}</p>
        <p className="text-xs text-ink-600">{sc.categoria}</p>
        <p className="mt-1 text-xs text-olive-700">Aperto · orari aggiornati</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {['Indicazioni', 'Chiama', 'Sito web', 'Ordina su MyCity'].map((b) => (
            <span key={b} className="rounded-full border border-cream-300 px-2 py-0.5 text-primary-700">{b}</span>
          ))}
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-ink-700">
        {sc.lavori.map((l) => (
          <li key={l} className="flex gap-1.5"><Check size={14} className="mt-px shrink-0 text-olive-700" aria-hidden /> {l}</li>
        ))}
      </ul>
    </Riquadro>
  );
}

/**
 * L'analisi del business nell'anteprima (24/11/2026): qui si dice solo cosa contiene. L'analisi vera,
 * coi dati del negozio, sta nella pagina del servizio dentro l'area del negozio, non nel link col codice.
 */
function CosaContieneLAnalisi() {
  const parti = [
    'La tua attività: che locale sei, chi sono i tuoi clienti, i tuoi punti di forza.',
    'I tuoi social e la scheda Google: cosa funziona, cosa migliorare.',
    'Il tuo sito: velocità dal telefono, se Google ti trova, se è facile da usare.',
    'Cosa fare il mese prossimo, in parole semplici.',
  ];
  return (
    <Riquadro icona={TrendingUp} titolo="Cosa contiene l’analisi" nota="Solo fonti pubbliche e gratuite: i tuoi canali li scrivi tu, e non ci servono password.">
      <ul className="space-y-1 text-xs text-ink-700">
        {parti.map((l) => (
          <li key={l} className="flex gap-1.5"><Check size={14} className="mt-px shrink-0 text-olive-700" aria-hidden /> {l}</li>
        ))}
      </ul>
    </Riquadro>
  );
}
