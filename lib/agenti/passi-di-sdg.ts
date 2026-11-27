import { FASCE as LISTINO, type Abbonamento, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { FASCE, euro } from '@/lib/agenti/fasce';
import { fraseVisita } from '@/lib/agenzia/visita';

/**
 * I PASSI DI SDG DOPO LA CONFERMA DEL TITOLARE — 27/11/2026, per la pagina «Adesso tocca a SDG» dell'agente.
 * Senza dipendenze dal server (li compone /api/agente/attivita, li disegna la pagina).
 */
export type Passo = { titolo: string; testo: string; perLui?: string | null };

/** Il testo del listino per un servizio della fascia: quello che il titolare ha letto quando ha confermato. */
const dalListino = (fascia: Abbonamento, servizio: ServizioAgenzia) => LISTINO[fascia].servizi[servizio];

/**
 * I passi di SDG da qui in poi, per la fascia scelta. Solo quello che il listino promette e che SDG fa davvero:
 * la visita, le prime foto e video, il piano del primo mese, il sito, i contanti al primo servizio. Dove la scheda
 * dell'agente ha la frase «su misura» per quel servizio, la si aggiunge per il locale.
 */
export function passiDiSdg(d: {
  nome: string;
  fascia: Abbonamento;
  visitaIl: string | null;
  canoneCentesimi: number | null;
  primoMeseCentesimi: number | null;
  pianoNellOrdine: { origine: 'sito' | 'ad'; stato: string } | null;
  suMisura?: Partial<Record<ServizioAgenzia, string>> | null;
}): Passo[] {
  const f = FASCE[d.fascia];
  const su = d.suMisura ?? {};
  const visita = fraseVisita(d.visitaIl);
  const canone = d.canoneCentesimi ?? LISTINO[d.fascia].prezzoMese;
  const piano = !d.pianoNellOrdine
    ? 'L’ordine di SDG non si legge da qui: avvisa Nicola, che lo controlla.'
    : d.pianoNellOrdine.origine === 'ad'
      ? 'È già nell’ordine di SDG, nella versione completa preparata dall’AD.'
      : 'È già nell’ordine di SDG nella prima versione; la versione completa, con gli eventi della città, il sito la chiede all’AD.';
  return [
    {
      titolo: 'La visita del team creativo',
      testo: d.visitaIl
        ? `Il team creativo di SDG passa da ${d.nome} nel giorno scelto dal titolare (${visita.replace(/^Visita: /, '')}): conosce il locale, raccoglie quello che serve e fa le prime riprese.`
        : `Il team creativo di SDG passa da ${d.nome} per conoscere il locale e fare le prime riprese. La data è da fissare col titolare.`,
    },
    { titolo: 'Le prime foto e i primi video', testo: `Si parte dalla visita. Con l’abbonamento ${f.nome}: «${dalListino(d.fascia, 'foto_video')}»`, perLui: su.foto_video ?? null },
    { titolo: 'Il piano editoriale del primo mese', testo: `${f.inPratica.piano}. ${piano}`, perLui: su.social ?? null },
    { titolo: 'Il sito', testo: `SDG prepara la bozza del sito. Con l’abbonamento ${f.nome}: «${dalListino(d.fascia, 'sito_web')}»`, perLui: su.sito_web ?? null },
    {
      titolo: 'I contanti, al primo servizio',
      testo: d.primoMeseCentesimi
        ? `Al primo servizio SDG ritira in contanti il primo mese: ${euro(d.primoMeseCentesimi)}. Poi ${euro(canone)} al mese, senza vincolo di durata.`
        : `L’abbonamento ${f.nome} costa ${euro(canone)} al mese, in contanti, di persona, al primo servizio. Senza vincolo di durata.`,
    },
  ];
}
