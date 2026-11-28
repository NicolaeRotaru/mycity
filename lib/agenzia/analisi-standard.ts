import { FASCE } from '@/lib/agenti/fasce';
import type { Abbonamento } from './preventivo';
import { ANALISI_PER_FASCIA } from './rapporto';
import type { AnalisiAvvioOrdine } from './analisi-dell-ordine-ad';
import type { Analisi } from './lavoro-consegnato/tipi';
import { canaleE } from './social-standard';

/**
 * LO STANDARD DELL'ANALISI DI MERCATO — 28/11/2026.
 *
 * Nicola, 28/11: «anche l'analisi di mercato è molto molto bella e vorrei che venisse usato come standard questo per
 * tutti. Poi va personalizzato in base all'abbonamento e in base al cliente».
 *
 * La base è l'analisi che SDG ha fatto per se stessa (lib/agenzia/lavoro-consegnato/sdg/analisi.json, disegnata da
 * components/seller/lavoro-consegnato/AnalisiConsegnata.tsx): sintesi, numeri chiave con la fonte, il mercato, i
 * concorrenti coi punti forti e deboli, forze-debolezze-opportunità-minacce, i clienti tipo, la presenza online,
 * cosa fare in ordine e le fonti. Qui ogni cliente prende la stessa forma:
 *  · DAL CLIENTE: l'analisi all'avvio scritta dall'AD (lib/agenzia/analisi-dell-ordine-ad.ts), i profili e il sito
 *    trovati dall'analisi della scheda;
 *  · DALL'ABBONAMENTO: le parti del rapporto e quanti concorrenti (ANALISI_PER_FASCIA, CONCORRENTI_PER_FASCIA), e
 *    cosa comprende la fascia: il ritmo, quello che dà in più e quello che non dà.
 * Quello che SDG aveva e il cliente no: i prezzi a confronto (le regole legali del 26/11 non li ammettono) e
 * l'abbonamento adatto a ogni cliente tipo (era il listino di SDG, non serve a un bar).
 */

export type DatiPerLAnalisiStandard = {
  nome: string;
  fascia: Abbonamento;
  canaliTrovati?: { canale: string; fonte: string | null }[] | null;
  /** Il sito trovato dall'analisi della scheda, se c'è. */
  sito?: string | null;
};

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null);

const CANALI = ['Instagram', 'Facebook', 'Scheda Google'] as const;

/** La presenza online: quello che l'analisi ha trovato. Mai «non c'è»: un profilo non visto si verifica alla visita. */
function presenza(d: DatiPerLAnalisiStandard): Analisi['presenza_online_sdg'] {
  const trovati = d.canaliTrovati ?? [];
  const sito = (d.sito ?? '').trim();
  return [
    { canale: 'Sito web', stato: sito ? 'trovato' : 'da verificare alla visita', indirizzo: https(sito), nota: null },
    ...CANALI.map((nome) => {
      const t = trovati.find((c) => canaleE(nome, c));
      return { canale: nome, stato: t ? 'trovato' : 'da verificare alla visita', indirizzo: https(t?.fonte), nota: null };
    }),
  ];
}

/**
 * L'analisi di un cliente nella forma standard (quella di SDG). Senza l'analisi dell'AD esce la forma vuota con la
 * presenza online e cosa comprende l'abbonamento: la pagina dice già «in preparazione» e non la mostra.
 */
export function analisiDallOrdine(avvio: AnalisiAvvioOrdine | null | undefined, d: DatiPerLAnalisiStandard): Analisi {
  const fascia: Abbonamento = d.fascia in FASCE ? d.fascia : 'base';
  const f = FASCE[fascia];
  const nome = (d.nome ?? '').trim() || 'la tua attività';
  const a = avvio && Array.isArray(avvio.parti) ? avvio : null;
  const piano = ANALISI_PER_FASCIA[fascia];

  const mercato: Analisi['mercato'] = (a?.parti ?? []).map((p) => ({
    titolo: p.titolo,
    testo: (p.frasi ?? []).join(' '),
    fonti: (p.fonti ?? []).map(https).filter((x): x is string => !!x),
  }));
  const concorrenti: Analisi['concorrenti'] = (a?.concorrenti ?? []).map((c) => ({
    nome: c.nome, tipo: null, cosa_fanno: c.cosaFanno, prezzo_indicativo: null,
    punti_forti: c.puntiForti ?? [], punti_deboli: c.puntiDeboli ?? [], fonte: https(c.fonte),
  }));
  const numeri: Analisi['numeri_chiave'] = (a?.numeriChiave ?? []).filter((n) => https(n.fonte)).map((n) => ({ voce: n.voce, valore: n.valore, fonte: n.fonte, da_confermare: null }));
  const fonti = Array.from(new Set([...mercato.flatMap((m) => m.fonti), ...concorrenti.map((c) => c.fonte), ...numeri.map((n) => n.fonte)].filter((x): x is string => !!x)));

  return {
    titolo: `Analisi di mercato ${f.nome} di ${nome}`,
    aggiornata_il: '',
    sintesi: (a?.sintesi ?? []).join('\n'),
    numeri_chiave: numeri,
    mercato,
    concorrenti,
    swot: {
      forze: a?.swot?.forze ?? [], debolezze: a?.swot?.debolezze ?? [],
      opportunita: a?.swot?.opportunita ?? [], minacce: a?.swot?.minacce ?? [],
    },
    clienti_tipo: (a?.clientiTipo ?? []).map((c) => ({ nome: c.nome, bisogno: c.bisogno, abbonamento_adatto: null, perche: c.perche ?? null })),
    prezzi: [],
    presenza_online_sdg: presenza(d),
    raccomandazioni: (a?.primeMosse ?? []).map((m, i) => ({ priorita: i + 1, cosa: m.cosa, perche: m.perche, quando: m.quando ?? null, costo: null })),
    fonti,
    titolo_presenza: 'La tua presenza online',
    compreso: { titolo: `Compreso nel ${f.nome}`, voci: [piano.ritmo, ...piano.inPiu, ...piano.nonComprende] },
    da_confermare: a?.daConfermare ?? [],
  };
}

/**
 * 28/11/2026 — Nicola: «questa analisi che si fa sul cliente la si usa per personalizzare il servizio». Dal rapporto
 * del cliente, quello che serve al piano social: cosa ha visto sui suoi social e, dove la fascia li comprende, sui
 * concorrenti. Sono frasi già passate dalle regole legali dell'analisi.
 */
export function daDovePartiamoSuiSocial(avvio: Pick<AnalisiAvvioOrdine, 'parti'> | null | undefined): string[] {
  const parti = Array.isArray(avvio?.parti) ? avvio!.parti : [];
  const di = (chiave: string) => parti.find((p) => p.parte === chiave)?.frasi ?? [];
  return [...di('social'), ...di('concorrenti_web')].slice(0, 6);
}
