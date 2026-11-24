/**
 * LA PAGELLA DELL'ATTIVITÀ SU MYCITY — 24/11/2026, dentro la pagina dell'analisi del business.
 *
 * Nicola: «fai la pagella del flusso 18 nella pagina dell'analisi». Il flusso 18 di n8n calcola, per
 * un'attività, a che punto è per arrivare al primo incasso (approvazione, carta, vetrina, prodotti,
 * ordini, incassi, clienti, recensioni, confronto con gli altri negozi) e la manda a Nicola su
 * Telegram. La sessione n8n (24/11) ha consigliato di calcolarla dal sito, che i dati li ha già:
 * questa è la stessa logica (repository N8N, flussi/18-analisi-attivita/codice/calcola-attivita.js),
 * con le stesse soglie, scritta per il titolare invece che per Nicola.
 *
 * Le regole del 18 restano:
 *  · i numeri li fa questo codice (niente IA);
 *  · una tabella che non si legge è «non misurato» (`null`), MAI zero: zero ordini e «non so quanti
 *    ordini» sono due cose diverse, e la pagina le dice diverse;
 *  · nessun dato personale: degli ordini si contano solo stati, date e importi; i clienti si contano,
 *    non si nominano.
 * Qui solo regole, senza rete: la rotta /api/seller/pagella legge e passa le righe.
 */

export const ORE_ORDINE_FERMO = 2;
export const ORE_PAYOUT = 24;
export const GIORNI_NEGOZIO_FERMO = 14;

const ORA = 3_600_000;
const GIORNO = 24 * ORA;

/** Una lettura: le righe, o `null` se la tabella non si è letta. `totale` > righe = conteggi parziali. */
export type Lettura<T> = { righe: T[]; totale?: number } | null;

export type ProfiloPerPagella = {
  role?: string | null;
  approval_status?: string | null;
  approval_requested_at?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  store_logo?: string | null;
  store_media?: unknown;
  store_description?: string | null;
  store_hours?: unknown;
  store_address?: string | null;
};
export type ProdottoPerPagella = { status?: string | null; images?: unknown; price?: number | string | null; stock?: number | null };
export type OrdinePerPagella = {
  payment_status?: string | null;
  delivery_status?: string | null;
  created_at?: string | null;
  user_id?: string | null;
  total_price?: number | string | null;
  payment_method?: string | null;
  payout_at?: string | null;
  canceled_at?: string | null;
  delivered_at?: string | null;
};
export type RecensionePerPagella = { rating?: number | null };

export type DatiPagella = {
  profilo: ProfiloPerPagella | null;
  prodotti: Lettura<ProdottoPerPagella>;
  ordini: Lettura<OrdinePerPagella>;
  recensioni: Lettura<RecensionePerPagella>;
  /** Per il confronto: quanti prodotti in vendita ha ogni altro negozio (seller_id → quanti). */
  confronto: Lettura<{ seller_id?: string | null }>;
  adesso: Date;
};

export type Avviso = { id: string; colore: 'rosso' | 'giallo'; titolo: string; cosaFare: string };

export type Pagella = {
  /** In parole: «in verifica», «approvata»… `null` se il profilo non si è letto. */
  stato: string | null;
  puoIncassareConCarta: boolean | null;
  vetrina: { manca: string[] } | null;
  numeri: {
    prodottiInVendita: number | null;
    prodottiSenzaFoto: number | null;
    prodottiSenzaPrezzo: number | null;
    ordini30g: number | null;
    incasso30g: number | null;
    scontrinoMedio30g: number | null;
    clienti: number | null;
    clientiTornati: number | null;
    recensioni: number | null;
    votoMedio: number | null;
    mediaProdottiAltriNegozi: number | null;
  };
  avvisi: Avviso[];
  /** Cosa non si è potuto misurare, in parole. */
  nonMisurato: string[];
};

const numero = (v: unknown, seVuoto: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : seVuoto;
};
const pieno = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(pieno);
  return true;
};
const euro = (v: number) => Math.round(v * 100) / 100;

// Al maschile: «Il tuo negozio è approvato» (collaudo, 24/11).
const STATI: Record<string, string> = { pending: 'in verifica', approved: 'approvato', rejected: 'non approvato', suspended: 'sospeso' };

export function pagella(d: DatiPagella): Pagella {
  const ADESSO = d.adesso.getTime();
  const quando = (iso: string | null | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? t : NaN;
  };
  const entro = (iso: string | null | undefined, ms: number) => {
    const t = quando(iso);
    return Number.isFinite(t) && ADESSO - t <= ms;
  };
  const piuVecchio = (iso: string | null | undefined, ms: number) => {
    const t = quando(iso);
    return Number.isFinite(t) && ADESSO - t > ms;
  };
  const giorniDa = (iso: string | null | undefined) => {
    const t = quando(iso);
    return Number.isFinite(t) ? Math.max(0, Math.floor((ADESSO - t) / GIORNO)) : null;
  };
  const se = <T, R>(l: Lettura<T>, f: (r: T[]) => R): R | null => (l ? f(l.righe) : null);

  const p = d.profilo;
  const stato = p ? (p.role === 'seller' ? STATI[p.approval_status ?? ''] ?? 'in preparazione' : null) : null;
  const vetrina = p
    ? {
        manca: [
          !pieno(p.store_logo) && 'il logo',
          !(Array.isArray(p.store_media) && p.store_media.length > 0) && 'le foto del negozio',
          !(typeof p.store_description === 'string' && p.store_description.trim().length >= 40) && 'la descrizione',
          !pieno(p.store_hours) && 'gli orari',
          !pieno(p.store_address) && 'l’indirizzo',
        ].filter((x): x is string => Boolean(x)),
      }
    : null;

  const nonFallito = (o: OrdinePerPagella) => o.payment_status !== 'FAILED';
  const pagato = (o: OrdinePerPagella) => o.payment_status === 'PAID';
  const inCorso = (o: OrdinePerPagella) => nonFallito(o) && !['DELIVERED', 'CANCELED'].includes(o.delivery_status ?? '') && !o.canceled_at;

  const ordini = d.ordini?.righe ?? [];
  const pagati30 = ordini.filter((o) => pagato(o) && entro(o.created_at, 30 * GIORNO));
  const perCliente = new Map<string, number>();
  for (const o of ordini) if (nonFallito(o) && o.user_id) perCliente.set(o.user_id, (perCliente.get(o.user_id) ?? 0) + 1);
  const venditori = new Map<string, number>();
  for (const r of d.confronto?.righe ?? []) if (r.seller_id) venditori.set(r.seller_id, (venditori.get(r.seller_id) ?? 0) + 1);
  const voti = (d.recensioni?.righe ?? []).map((r) => numero(r.rating, 0)).filter((x) => x > 0);
  const incasso = pagati30.reduce((s, o) => s + numero(o.total_price, 0), 0);

  const n: Pagella['numeri'] = {
    prodottiInVendita: se(d.prodotti, (r) => r.filter((x) => x.status === 'available').length),
    prodottiSenzaFoto: se(d.prodotti, (r) => r.filter((x) => !Array.isArray(x.images) || x.images.length === 0).length),
    prodottiSenzaPrezzo: se(d.prodotti, (r) => r.filter((x) => !(numero(x.price, 0) > 0)).length),
    ordini30g: se(d.ordini, (r) => r.filter((o) => nonFallito(o) && entro(o.created_at, 30 * GIORNO)).length),
    incasso30g: d.ordini ? euro(incasso) : null,
    scontrinoMedio30g: d.ordini && pagati30.length ? euro(incasso / pagati30.length) : null,
    clienti: d.ordini ? perCliente.size : null,
    clientiTornati: d.ordini ? [...perCliente.values()].filter((x) => x >= 2).length : null,
    recensioni: d.recensioni ? voti.length : null,
    votoMedio: d.recensioni && voti.length ? Math.round((voti.reduce((a, b) => a + b, 0) / voti.length) * 10) / 10 : null,
    mediaProdottiAltriNegozi: d.confronto && venditori.size ? Math.round(((d.confronto.righe.length) / venditori.size) * 10) / 10 : null,
  };

  // ---- gli avvisi: le sentinelle del 18, dette al titolare ----
  const avvisi: Avviso[] = [];
  const suona = (id: string, colore: Avviso['colore'], titolo: string, cosaFare: string) => avvisi.push({ id, colore, titolo, cosaFare });
  // Il trasferimento parte solo a ordine consegnato (lib/stripe/payout.ts): si conta dalla consegna, non
  // dal pagamento. Diverso dal 18, che lo legge Nicola: qui lo legge il titolare, e un rosso falso spaventa.
  const pagatiSenzaSoldi = se(d.ordini, (r) =>
    r.filter((o) => pagato(o) && o.payment_method !== 'cod' && o.delivery_status === 'DELIVERED' && !o.payout_at && piuVecchio(o.delivered_at, ORE_PAYOUT * ORA)).length);
  if (pagatiSenzaSoldi) {
    suona('payout-bloccato', 'rosso', `${pagatiSenzaSoldi} ${pagatiSenzaSoldi === 1 ? 'ordine consegnato' : 'ordini consegnati'} da più di ${ORE_PAYOUT} ore, pagati con la carta, e i soldi non ti sono ancora stati trasferiti`, 'Scrivici dall’Aiuto: controlliamo noi il trasferimento.');
  }
  if (p?.role === 'seller' && p.approval_status === 'pending') {
    const giorni = giorniDa(p.approval_requested_at || p.created_at);
    suona('in-verifica', 'giallo', `Il tuo negozio è in verifica${giorni !== null ? ` da ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}` : ''}`, 'Intanto prepara i prodotti: appena è approvato, vendi subito.');
  }
  if (p && (p.approval_status === 'rejected' || p.approval_status === 'suspended')) {
    suona('fermo', 'giallo', `Il tuo negozio è ${stato}`, 'Scrivici dall’Aiuto per capire cosa manca.');
  }
  const puoIncassare = p ? p.stripe_charges_enabled === true && p.stripe_payouts_enabled === true : null;
  if (p?.approval_status === 'approved' && puoIncassare === false) {
    suona('niente-carta', 'giallo', 'Non puoi ancora incassare con la carta: i dati per i pagamenti non sono completi', 'Finisci la registrazione dei pagamenti dal tuo Profilo, o parti coi contanti alla consegna.');
  }
  if (n.prodottiInVendita === 0) {
    suona('nessun-prodotto', 'giallo', 'Non hai ancora nessun prodotto in vendita', `Carica i primi prodotti con foto e prezzo${n.mediaProdottiAltriNegozi ? `: gli altri negozi che vendono ne hanno in media ${n.mediaProdottiAltriNegozi.toLocaleString('it-IT')}` : ''}.`);
  }
  if (n.prodottiSenzaFoto) {
    suona('senza-foto', 'giallo', `${n.prodottiSenzaFoto} ${n.prodottiSenzaFoto === 1 ? 'prodotto è' : 'prodotti sono'} senza foto`, 'Senza foto un prodotto non si vende: le facciamo noi col servizio Foto e video.');
  }
  if (n.prodottiSenzaPrezzo) {
    suona('senza-prezzo', 'giallo', `${n.prodottiSenzaPrezzo} ${n.prodottiSenzaPrezzo === 1 ? 'prodotto è' : 'prodotti sono'} senza prezzo`, 'Scrivi il prezzo nella scheda del prodotto: senza, non si può comprare.');
  }
  if (vetrina && vetrina.manca.length >= 2) {
    suona('vetrina', 'giallo', `Alla tua vetrina mancano ${vetrina.manca.join(', ')}`, 'È la prima cosa che vede il cliente: completala da «Costruisci il sito».');
  }
  const fermi = se(d.ordini, (r) => r.filter((o) => inCorso(o) && piuVecchio(o.created_at, ORE_ORDINE_FERMO * ORA)).length);
  if (fermi) {
    suona('ordini-fermi', 'giallo', `${fermi} ${fermi === 1 ? 'ordine aperto' : 'ordini aperti'} da più di ${ORE_ORDINE_FERMO} ore e non ancora ${fermi === 1 ? 'consegnato' : 'consegnati'}`, 'Il cliente sta aspettando: guarda gli ordini.');
  }
  const giorniApprovata = p?.approval_status === 'approved' ? giorniDa(p.approved_at) : null;
  const ordini14 = se(d.ordini, (r) => r.filter((o) => nonFallito(o) && entro(o.created_at, GIORNI_NEGOZIO_FERMO * GIORNO)).length);
  if (giorniApprovata !== null && giorniApprovata > GIORNI_NEGOZIO_FERMO && ordini14 === 0) {
    suona('fermo-da-giorni', 'giallo', `Nessun ordine negli ultimi ${GIORNI_NEGOZIO_FERMO} giorni`, 'Ne parliamo insieme: i social e la scheda Google portano i primi clienti.');
  }
  const basse = se(d.recensioni, (r) => r.filter((x) => numero(x.rating, 5) <= 2).length);
  if (basse) {
    suona('recensioni-basse', 'giallo', `${basse} ${basse === 1 ? 'recensione' : 'recensioni'} con 1 o 2 stelle`, 'Rispondi con calma e gentilezza: chi legge guarda come rispondi.');
  }

  const nonMisurato: string[] = [];
  const NOMI = { prodotti: 'i tuoi prodotti', ordini: 'i tuoi ordini', recensioni: 'le tue recensioni', confronto: 'il confronto con gli altri negozi' } as const;
  const NON_LETTI = { prodotti: 'non letti', ordini: 'non letti', recensioni: 'non lette', confronto: 'non letto' } as const;
  if (!p) nonMisurato.push('la scheda del tuo negozio');
  for (const k of Object.keys(NOMI) as (keyof typeof NOMI)[]) {
    const l = d[k];
    if (!l) nonMisurato.push(`${NOMI[k]}: ${NON_LETTI[k]}`);
    else if (l.totale !== undefined && l.totale > l.righe.length) nonMisurato.push(`${NOMI[k]}: contati i primi ${l.righe.length} su ${l.totale}`);
  }

  return { stato, puoIncassareConCarta: puoIncassare, vetrina, numeri: n, avvisi, nonMisurato };
}
