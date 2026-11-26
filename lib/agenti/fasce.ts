// I tre abbonamenti come li legge l'agente in strada.
// Nome e canone NON si ripetono qui: vengono dal listino del sito (lib/agenzia/preventivo.ts → FASCE), che è
// l'unico posto dove Nicola cambia i prezzi. Qui c'è solo quello che serve alla scheda: quanti contenuti e
// video dà ogni fascia, e cosa vuol dire in pratica (uguale a cervello/scheda-cliente.mjs nel repo dell'AD).
// La prova tests/unit/agenti/fasce.test.ts diventa rossa se il listino del sito e questi numeri si separano.

import { FASCE as LISTINO, type Abbonamento } from '@/lib/agenzia/preventivo';

export type IdFascia = Abbonamento;

export type Fascia = {
  nome: string;
  centesimi: number;
  post: number;
  video: number;
  inPratica: { sito: string; piano: string; foto: string; analisi: string };
  perChi: string;
};

const PRATICA: Record<IdFascia, Omit<Fascia, 'nome' | 'centesimi' | 'perChi'>> = {
  base: {
    post: 8, video: 0,
    inPratica: { sito: 'Una pagina col vostro nome', piano: '8 contenuti al mese, senza video', foto: 'Una sessione all’avvio', analisi: 'Una, all’avvio' },
  },
  business: {
    post: 12, video: 2,
    inPratica: { sito: 'Più pagine col vostro nome', piano: '12 contenuti al mese, di cui 2 video brevi', foto: 'Una sessione di foto ogni tre mesi, più un video al mese', analisi: 'Una ogni mese' },
  },
  premium: {
    post: 20, video: 4,
    inPratica: { sito: 'Più pagine, aggiornato da noi ogni mese', piano: '20 contenuti al mese, 4 sono video, più le storie', foto: 'Foto e video ogni mese', analisi: 'Una ogni settimana, e un incontro al mese' },
  },
};

export const ID_FASCE = Object.keys(PRATICA) as IdFascia[];

export const FASCE: Record<IdFascia, Fascia> = Object.fromEntries(
  ID_FASCE.map((id) => [id, { nome: LISTINO[id].nome, centesimi: LISTINO[id].prezzoMese, perChi: LISTINO[id].perChi, ...PRATICA[id] }]),
) as Record<IdFascia, Fascia>;

/** Il 10% sui prodotti venduti tramite MyCity resta anche con l'abbonamento (pricing.commissione, 26/11/2026). */
export const CONDIZIONI = 'Nessun vincolo di durata: disdici quando vuoi, con 30 giorni di preavviso. Il primo mese costa la metà. Su quello che vendete al banco non prendiamo niente; sui prodotti venduti tramite MyCity resta il 10%, che paga la consegna e il servizio.';

/** Come si paga oggi (sdg.pagamento, 26/11/2026). */
export const PAGAMENTO = 'Per ora l’abbonamento si paga in contanti, di persona: il pagamento online sul sito arriva più avanti.';

export const euro = (c: number) =>
  (c / 100).toLocaleString('it-IT', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

export const eFascia = (v: unknown): v is IdFascia => typeof v === 'string' && v in FASCE;
