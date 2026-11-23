import { Camera, CalendarDays, Film, Globe, Sparkles } from 'lucide-react';
import type { ServizioAgenzia } from '@/lib/agenzia/preventivo';
import type { TipoAttivita } from '@/lib/agenzia/tipi-attivita';
import {
  bozzaSito,
  FORMATI_FOTO,
  FORMATI_VIDEO,
  LAVORI_DI_EDITING,
  pianoEditoriale,
  type FormatoMedia,
} from '@/lib/agenzia/contenuti-servizi';

/**
 * COSA RICEVI — l'anteprima di un servizio, dentro il preventivo e dentro la pagina del
 * servizio (Nicola, 23/11/2026). Sito → la bozza del sito col nome del cliente; social → il
 * piano editoriale del mese con esempi; foto e video → i formati e i lavori di editing.
 * I contenuti li calcola `lib/agenzia/contenuti-servizi.ts`: qui si disegna soltanto.
 */

type Props = { id: ServizioAgenzia; nome: string; tipo: TipoAttivita; giorno: string };

export default function AnteprimaServizio({ id, nome, tipo, giorno }: Props) {
  if (id === 'sito_web') return <BozzaDelSito nome={nome} tipo={tipo} />;
  if (id === 'social') return <PianoDelMese nome={nome} tipo={tipo} giorno={giorno} />;
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

function BozzaDelSito({ nome, tipo }: { nome: string; tipo: TipoAttivita }) {
  const b = bozzaSito(nome, tipo);
  return (
    <Riquadro icona={Globe} titolo="La bozza del tuo sito" nota="Una prima bozza fatta con i tuoi dati: testi e foto li completiamo insieme.">
      <div className="overflow-hidden rounded-lg border border-cream-300 bg-white shadow-sm">
        {/* La barra del browser: l'indirizzo è un suggerimento, da verificare se è libero. */}
        <div className="flex items-center gap-2 border-b border-cream-200 bg-cream-100 px-3 py-1.5">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
          </span>
          <span className="flex-1 truncate rounded bg-white px-2 py-0.5 font-mono text-[11px] text-ink-600">{b.indirizzo}</span>
        </div>
        <div className="bg-ink-900 px-4 py-6 text-center text-white">
          <p className="font-serif text-xl font-bold">{b.nome}</p>
          <p className="mt-1 text-xs text-cream-100">{b.sottotitolo}</p>
          <span className="mt-3 inline-block rounded-full bg-primary-700 px-3 py-1 text-xs font-bold">{b.invito}</span>
        </div>
        <div className="grid gap-px bg-cream-200 sm:grid-cols-2">
          {b.sezioni.map((s) => (
            <div key={s.titolo} className="bg-white p-3">
              <p className="text-xs font-bold text-ink-900">{s.titolo}</p>
              <p className="mt-0.5 text-xs text-ink-600">{s.testo}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-500">L&apos;indirizzo {b.indirizzo} è un suggerimento: prima di comprarlo verifichiamo che sia libero.</p>
    </Riquadro>
  );
}

const giornoCorto = (data: string) =>
  new Date(`${data}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

function PianoDelMese({ nome, tipo, giorno }: { nome: string; tipo: TipoAttivita; giorno: string }) {
  const piano = pianoEditoriale(nome, tipo, giorno);
  return (
    <Riquadro
      icona={CalendarDays}
      titolo={`Il piano editoriale di ${piano.mese}`}
      nota={`${piano.post.length} post, 3 a settimana. Sono esempi: i post veri li prepara il nostro sistema automatico con le foto della tua vetrina, e tu li approvi prima che escano.`}
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
    <Riquadro icona={Sparkles} titolo="I formati che ricevi" nota="Quanti scatti e quanti video ogni mese lo fissiamo insieme, dentro la fascia di prezzo.">
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
