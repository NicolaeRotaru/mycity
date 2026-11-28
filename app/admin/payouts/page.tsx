'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Banknote, Clock, CheckCircle2, Store, Info, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle, AdminStatCard } from '@/components/admin/AdminUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import { CARTA_ACCESA } from '@/lib/funzioni-al-lancio';
import { ordiniDaVersareLunedi, gruppoDelPannello, nettoDopoStorni, settimanaPrima, type GruppoDelPannello, type OrdineNegozio } from '@/lib/guadagni/negozio';
import type { ContantiDaStripe } from '@/app/api/admin/contanti-da-stripe/route';

/**
 * Payout venditori (admin · Trust & Safety).
 *
 * R11-001 / R11-004 — Al lancio i contanti li versa Nicola a mano il lunedì: la
 * pagina dice quanto versare a ogni negozio («Da versare lunedì») e il tasto
 * «Bonifico fatto» lo registra (migrazione 916). La carta resta automatica.
 *
 * R22-002 — Dal bonifico si toglie la commissione dei ritiri pagati al banco (regola
 * ritiro.in-negozio); se non basta, il resto va nella fattura del mese. Trattenuta e resto
 * restano scritti col bonifico (migrazione 916): «Già pagato» è quello che è partito davvero.
 *
 * Legge la tabella `orders` (netto, storni, stato del bonifico) e raggruppa per negozio. La regola
 * degli stati sta in lib/guadagni/negozio.ts (`gruppoDelPannello`): contanti con la rimessa
 * confermata = «Da versare»; contanti ancora dal fattorino, carta in attesa del giro, IBAN da
 * verificare = «In sospeso»; ritiri al banco, storni e rimborsi = fuori dai totali.
 */

type PayoutOrder = {
  id: string;
  seller_id: string | null;
  total_price: number | string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents: number | null;
  /** R22-002 — La commissione MyCity dell'ordine: sui ritiri pagati al banco si trattiene dal bonifico. */
  application_fee_cents?: number | null;
  /** Il credito MyCity usato dal cliente: su un ritiro al banco il negozio ha incassato il lordo meno questo. */
  wallet_applied_cents?: number | null;
  dispute_status?: string | null;
  internal_dispute_status?: string | null;
  payment_status?: string | null;
  pratica_aperta?: boolean;
  /** R05-002 — contante consegnato da quando i contanti li paga Stripe: non si versa a mano. */
  lo_paga_stripe?: boolean;
  /**
   * R05-002 (collaudo) — contante HELD che Stripe potrebbe pagare, ma il giorno d'inizio non si è
   * ancora letto (lettura in corso o caduta): non si sa se versarlo, quindi non si versa.
   */
  stripe_incerto?: boolean;
  payout_status: string | null;
  payout_at: string | null;
  stripe_transfer_id: string | null;
  delivery_status: string | null;
  payment_method: string | null;
  created_at: string | null;
  delivered_at: string | null;
  seller: { store_name: string | null; billing_iban: string | null } | null;
};

type PayoutTone = 'ready' | 'hold' | 'paid' | 'fuori';

const CLASSI: Record<GruppoDelPannello, string> = {
  da_versare: 'bg-olive-100 text-olive-800',
  in_sospeso: 'bg-accent-100 text-accent-800',
  pagato: 'bg-cream-200 text-ink-600',
  fuori: 'bg-secondary-100 text-secondary-700',
};
const TONO: Record<GruppoDelPannello, PayoutTone> = { da_versare: 'ready', in_sospeso: 'hold', pagato: 'paid', fuori: 'fuori' };

/**
 * R11-001 — Lo stato del bonifico per il pannello: la regola sta in
 * lib/guadagni/negozio.ts (`gruppoDelPannello`). «Da versare» sono i contanti
 * con la rimessa confermata: quelli che Nicola versa a mano il lunedì.
 */
function payoutTone(o: PayoutOrder): { tone: PayoutTone; label: string; cls: string } {
  if (bonificoStripeAppeso(o)) return { tone: 'hold', label: 'Fermo: bonifico Stripe da controllare', cls: CLASSI.in_sospeso };
  if (o.lo_paga_stripe) return { tone: 'hold', label: 'In sospeso · lo paga Stripe', cls: CLASSI.in_sospeso };
  if (o.stripe_incerto) return { tone: 'hold', label: 'In sospeso · non so se lo paga Stripe', cls: CLASSI.in_sospeso };
  const { gruppo, etichetta } = gruppoDelPannello(o);
  const label = o.payout_status === 'PAID_MANUALLY' && o.payout_at ? `${etichetta} ${fmtDate(o.payout_at)}` : etichetta;
  return { tone: TONO[gruppo], label, cls: CLASSI[gruppo] };
}

/**
 * R22-002 — Un contante HELD con un bonifico Stripe già scritto (un PROCESSING appeso rimesso in HELD dal
 * giro): la 916 non lo segna, perché il bonifico Stripe potrebbe essere partito. Non entra nella cifra
 * del lunedì né nel tasto: resta in sospeso con la sua etichetta, da controllare su Stripe.
 */
function bonificoStripeAppeso(o: PayoutOrder): boolean {
  return o.payment_method === 'cod' && o.payout_status === 'HELD' && !!o.stripe_transfer_id;
}

/**
 * R05-002 — Con PAGAMENTI_CONTANTI_DA_STRIPE_DAL valida i contanti HELD consegnati da quell'istante li paga
 * il giro con Stripe (contantiPagabiliDaStripe, lib/stripe/payout.ts): versati anche a mano, sarebbero
 * pagati due volte. `dal` arriva dal server (/api/admin/contanti-da-stripe); `null` = li versi tu.
 */
function loPagaStripe(o: PayoutOrder, dal: number | null): boolean {
  if (dal === null || !potrebbePagarloStripe(o)) return false;
  return Date.parse(o.delivered_at as string) >= dal;
}

/**
 * R05-002 (collaudo) — Un contante che il giro pagherebbe con Stripe se il giorno d'inizio fosse prima della
 * sua consegna: contanti HELD con una consegna leggibile (contantiPagabiliDaStripe, lib/stripe/payout.ts).
 * Finché quel giorno non si è letto, questi sono incerti: versati a mano rischiano di essere pagati due volte.
 */
function potrebbePagarloStripe(o: PayoutOrder): boolean {
  if (o.payment_method !== 'cod' || o.payout_status !== 'HELD' || !o.delivered_at) return false;
  return !Number.isNaN(Date.parse(o.delivered_at));
}

/**
 * Fuori dal bonifico del lunedì e dal tasto: un bonifico Stripe appeso, un contante che paga Stripe, o un
 * contante che non si sa ancora se lo paga Stripe.
 */
const fuoriDalBonifico = (o: PayoutOrder) => bonificoStripeAppeso(o) || o.lo_paga_stripe === true || o.stripe_incerto === true;

/** R05-002 — L'istante da cui i contanti li paga Stripe, o `null`. Un esito storto è un errore, non un «no». */
async function leggiContantiDaStripe(): Promise<number | null> {
  const r = await fetch('/api/admin/contanti-da-stripe', { cache: 'no-store' });
  const corpo = (await r.json().catch(() => null)) as { ok?: boolean; data?: Partial<ContantiDaStripe> } | null;
  const dal = corpo?.data?.dal;
  if (r.ok && corpo?.ok === true && dal === null) return null;
  if (r.ok && corpo?.ok === true && typeof dal === 'number' && Number.isFinite(dal)) return dal;
  throw new Error('contanti da Stripe: esito non previsto');
}

type SellerGroup = {
  sellerId: string;
  storeName: string;
  iban: string | null;
  orders: PayoutOrder[];
  dueCents: number; // da versare: il lunedì più questa settimana, ognuno meno la sua commissione
  lunediCents: number; // il bonifico del lunedì: consegnati entro la domenica scorsa, meno la commissione
  settimanaCents: number; // quello che resta per il lunedì dopo (questa settimana)
  lunedi: ContoDelLunedi;
  holdCents: number; // in sospeso (carta in attesa del giro, contanti dal fattorino, IBAN)
  paidCents: number; // già partito davvero: bonifici della carta e bonifici a mano
  inFattura: { mese: string; cents: number }[]; // commissione dei ritiri al banco rimasta da fatturare
  recuperoCents: number; // contanti versati a mano e poi rimborsati: da riprendere dal negozio
  recuperoOrdini: number;
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '—';

/** Il netto che spetta davvero al negozio: meno gli storni (rimborsi, contestazioni). */
const netto = (o: PayoutOrder) => nettoDopoStorni(o as unknown as OrdineNegozio);

const giornoDiRoma = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const meseDiRoma = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(d);
const nomeDelMese = (mese: string) => new Date(`${mese}-15T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

/**
 * R22-002 — Un ritiro pagato in contanti al banco con la commissione ancora da regolare: il negozio
 * ha già tutto in cassa e la commissione MyCity si toglie dal bonifico del lunedì (regola
 * ritiro.in-negozio). «Regolata» vuol dire payout_at scritto da segna_bonifico_manuale (916), che
 * guarda gli stessi cancelli.
 */
function ritiroDaRegolare(o: PayoutOrder): boolean {
  return (
    o.payment_method === 'cod' && o.payout_status === 'CASH_IN_STORE' && !o.payout_at &&
    // Gli stessi cancelli dei contanti (916): con un reso, un reclamo, una contestazione o un rimborso,
    // anche parziale, la commissione aspetta.
    o.pratica_aperta !== true &&
    (!o.dispute_status || o.dispute_status === 'WON') &&
    (!o.internal_dispute_status || o.internal_dispute_status === 'RESOLVED') &&
    o.payment_status !== 'REFUNDED' && o.payment_status !== 'PARTIALLY_REFUNDED'
  );
}

type ContoDelLunedi = {
  contanti: PayoutOrder[];
  ritiri: PayoutOrder[];
  contantiCents: number;
  creditoCents: number;
  commissioneCents: number;
  trattenutaCents: number;
  importoCents: number;
  inFatturaCents: number;
};

/**
 * Contanti più credito MyCity dei ritiri meno commissione dei ritiri, in centesimi interi e mai sotto
 * zero: il resto va in fattura. Su un ritiro il negozio ha incassato in cassa il lordo meno il credito
 * usato dal cliente, quindi MyCity gli deve «credito − commissione» (lo stesso conto della 916).
 */
function conto(contanti: PayoutOrder[], ritiri: PayoutOrder[]): ContoDelLunedi {
  const contantiCents = contanti.reduce((s, o) => s + netto(o), 0);
  const creditoCents = ritiri.reduce((s, o) => s + Math.max(0, Math.round(Number(o.wallet_applied_cents) || 0)), 0);
  const commissioneCents = ritiri.reduce((s, o) => s + Math.max(0, Math.round(Number(o.application_fee_cents) || 0)), 0);
  const trattenutaCents = Math.min(contantiCents + creditoCents, commissioneCents);
  return {
    contanti,
    ritiri,
    contantiCents,
    creditoCents,
    commissioneCents,
    trattenutaCents,
    importoCents: contantiCents + creditoCents - trattenutaCents,
    inFatturaCents: commissioneCents - trattenutaCents,
  };
}

/** Il bonifico del lunedì: contanti e ritiri consegnati entro la domenica scorsa (arretrati compresi). */
function contoDelLunedi(ordini: PayoutOrder[], adesso: Date): ContoDelLunedi {
  const { al } = settimanaPrima(adesso);
  const ritiri = ordini.filter((o) => ritiroDaRegolare(o) && !!o.delivered_at && giornoDiRoma(o.delivered_at) <= al);
  return conto(ordiniDaVersareLunedi(ordini.filter((o) => !fuoriDalBonifico(o)), adesso), ritiri);
}

/** Quello che resta per il lunedì dopo: contanti e ritiri di questa settimana, con la loro commissione. */
function contoDiQuestaSettimana(ordini: PayoutOrder[], adesso: Date): ContoDelLunedi {
  const lunedi = contoDelLunedi(ordini, adesso);
  const nelLunedi = new Set([...lunedi.contanti, ...lunedi.ritiri].map((o) => o.id));
  return conto(
    ordini.filter((o) => gruppoDelPannello(o).gruppo === 'da_versare' && !fuoriDalBonifico(o) && !nelLunedi.has(o.id)),
    ordini.filter((o) => ritiroDaRegolare(o) && !nelLunedi.has(o.id)),
  );
}

/** Una riga di contanti_da_recuperare (916): un contante versato a mano e poi rimborsato al cliente. */
type DaRecuperare = { order_id: string; seller_id: string; store_name: string | null; da_recuperare_cents: number };

/** Una riga di bonifici_manuali_per_mese (916): versato e in fattura, per negozio e mese. */
type BonificiDelMese = { seller_id: string; mese: string; importo_cents: number; in_fattura_cents: number };
const centesimi = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));

/** Maschera l'IBAN mostrando prefisso paese + ultime 4 (display, dato reale). */
function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

/**
 * Quanti ordini consegnati legge al massimo questa pagina. Arrivati al tetto i riquadri sommano
 * solo quello che e' stato letto: la pagina lo dice, invece di spacciare un totale parziale.
 */
const TETTO_PAYOUT = 1000;

/**
 * R05-001 — I bonifici chiusi: pagati (carta o a mano), rimborsati, stornati, ritiri pagati al banco.
 * Crescono sempre: letti insieme agli aperti, oltre le mille righe spingevano fuori dal tetto proprio
 * i contanti più vecchi ancora da versare. Gli aperti si leggono da soli; i chiusi a parte, per
 * «Già pagato» e per l'elenco.
 */
// R22-001 — anche lo storno non riuscito: è fuori dai totali e non deve prendere il posto di un contante da versare.
const STATI_CHIUSI = ['TRANSFERRED', 'PAID_MANUALLY', 'REFUNDED', 'REVERSED', 'REVERSAL_FAILED', 'CASH_IN_STORE'];
/** R22-002 — Un ritiro al banco con la commissione ancora da regolare resta fra gli aperti. */
const RITIRO_DA_REGOLARE = 'and(payout_status.eq.CASH_IN_STORE,payout_at.is.null)';
/**
 * R22-001 — Quello che il lunedì si paga: contanti HELD e ritiri al banco da regolare. Si leggono da
 * soli, col loro tetto, dal consegnato prima: le righe ferme (contanti dal fattorino, reclami, IBAN,
 * carte in attesa) non li spingono fuori, e se si tagliano restano fuori le consegne più recenti.
 */
const PAGABILI = `and(payout_status.eq.HELD,payment_method.eq.cod),${RITIRO_DA_REGOLARE}`;

/** Lo stesso insieme di PAGABILI, sulla riga già letta. */
const pagabile = (o: PayoutOrder) =>
  (o.payout_status === 'HELD' && o.payment_method === 'cod') || (o.payout_status === 'CASH_IN_STORE' && !o.payout_at);

type LettiPayout = PayoutOrder[] & {
  totale?: number;
  chiusi?: PayoutOrder[];
  totaleChiusi?: number;
  tagliato?: boolean;
  tagliatoPagabili?: boolean;
};

/**
 * R11-004 — «Bonifico fatto»: segna come pagati a mano i contanti con la rimessa
 * confermata (HELD) di un negozio. Lo scrive `segna_bonifico_manuale` (migrazione
 * 916), riservata agli amministratori: da qui parte solo la richiesta.
 */
function BonificoFatto({ sellerId, storeName, ordini, quandoFatto, parziale = false }: {
  sellerId: string;
  storeName: string;
  ordini: PayoutOrder[];
  quandoFatto: () => void;
  /** R22-001 — l'elenco dei contanti da versare è tagliato: questo bonifico è solo una parte del dovuto. */
  parziale?: boolean;
}) {
  const [stato, setStato] = useState<'pronto' | 'invio' | 'errore'>('pronto');
  const [esito, setEsito] = useState<string | null>(null);
  // R05-002 (collaudo) — Non si sa ancora da quando i contanti li paga Stripe: un bonifico segnato adesso
  // potrebbe includerne uno che pagherà anche il giro. Niente tasto per questo negozio finché non si sa.
  const incerti = ordini.filter((o) => o.stripe_incerto === true);
  if (incerti.length > 0) {
    return (
      <p role="status" className="mt-1.5 max-w-xs text-xs font-semibold text-secondary-700">
        «Bonifico fatto» fermo: non so ancora se {incerti.length === 1 ? 'il contante in sospeso lo paga' : `i ${incerti.length} contanti in sospeso li paga`}{' '}
        Stripe ({formatPrice(incerti.reduce((s, o) => s + netto(o), 0) / 100)}). Non versarli finché la pagina non lo sa.
      </p>
    );
  }
  // R11-001 — si segnano gli stessi ordini di «Da versare lunedì»: quelli di questa settimana aspettano il prossimo.
  // R22-002 — con i ritiri al banco dello stesso periodo: la loro commissione si trattiene dal bonifico.
  const c = contoDelLunedi(ordini, new Date());
  const daSegnare = c.contanti;
  if (daSegnare.length === 0 && c.ritiri.length === 0) return esito ? <p role="status" className="mt-1.5 text-xs text-ink-600">{esito}</p> : null;
  const totale = c.importoCents;
  const segna = async () => {
    let riferimento: string | null = null;
    if (totale > 0) {
      const credito = c.creditoCents > 0 ? ` più ${formatPrice(c.creditoCents / 100)} di credito MyCity dei ritiri al banco` : '';
      const commissione = c.trattenutaCents > 0 || c.creditoCents > 0 ? ` (contanti ${formatPrice(c.contantiCents / 100)}${credito}${c.trattenutaCents > 0 ? ` meno ${formatPrice(c.trattenutaCents / 100)} di commissione dei ritiri al banco` : ''})` : '';
      const parte = parziale ? `\nÈ solo una parte di quanto devi a ${storeName}: l’elenco è tagliato a ${TETTO_PAYOUT} ordini. Dopo il bonifico ricarica la pagina per il resto.` : '';
      const scritto = window.prompt(
        `Bonifico a ${storeName}: ${formatPrice(totale / 100)}${commissione} per ${daSegnare.length} ordini in contanti.${parte}\nScrivi il riferimento del bonifico (CRO/TRN o data):`,
      );
      if (!scritto || scritto.trim().length < 3) return;
      riferimento = scritto.trim();
    } else {
      // Commissione ≥ contanti: nessun bonifico da fare, quindi nessun riferimento da chiedere.
      const ok = window.confirm(
        `Nessun bonifico da fare a ${storeName}: la commissione dei ritiri al banco (${formatPrice(c.commissioneCents / 100)}) copre i contanti${c.creditoCents > 0 ? ' e il credito MyCity dei ritiri' : ''} (${formatPrice((c.contantiCents + c.creditoCents) / 100)}).\nSegno la compensazione?${c.inFatturaCents > 0 ? ` ${formatPrice(c.inFatturaCents / 100)} di commissione vanno nella fattura del mese.` : ''}`,
      );
      if (!ok) return;
    }
    setStato('invio');
    const { data: segnati, error } = await supabase.rpc('segna_bonifico_manuale', {
      p_seller: sellerId,
      p_order_ids: daSegnare.map((o) => o.id),
      p_riferimento: riferimento,
      p_ritiri: c.ritiri.map((o) => o.id),
      p_importo_cents: totale,
    } as never);
    if (error) {
      // Tutto o niente (916): se nel frattempo è cambiato qualcosa non resta scritto niente.
      const messaggio = String((error as { message?: unknown }).message ?? '');
      // Lo stesso bonifico è già scritto con un altro riferimento o un'altra cifra (916): lo si dice.
      const giaSegnato = /BONIFICO_GIA_SEGNATO:\s*(.*)$/.exec(messaggio);
      if (giaSegnato) {
        setEsito(`Non l’ho riscritto: ${giaSegnato[1]}. Se il bonifico è un altro, ricarica e controlla.`);
        setStato('pronto');
        quandoFatto();
        return;
      }
      const cambiato = /BONIFICO_CAMBIATO/.test(messaggio);
      setEsito(cambiato ? 'Non l’ho segnato: nel frattempo la cifra è cambiata (un reso, un reclamo o un ordine già segnato). Ricarica e controlla prima di segnare.' : null);
      setStato(cambiato ? 'pronto' : 'errore');
      if (cambiato) quandoFatto();
      return;
    }
    // Collaudo K04 — la funzione dice quanti ne ha segnati davvero: se sono meno, lo si dice.
    const n = typeof segnati === 'number' ? segnati : 0;
    setEsito(
      n === daSegnare.length
        ? totale > 0
          ? `Segnati ${n} ordini come pagati.`
          : c.inFatturaCents > 0
            ? `Compensazione segnata: ${formatPrice(c.inFatturaCents / 100)} di commissione vanno nella fattura del mese.`
            : 'Compensazione segnata.'
        : `Attenzione: segnati ${n} ordini su ${daSegnare.length}. Gli altri nel frattempo hanno un reso, un reclamo o una contestazione e restano da versare: controlla il bonifico fatto.`,
    );
    setStato('pronto');
    quandoFatto();
  };
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => void segna()}
        disabled={stato === 'invio'}
        className="rounded-lg border border-olive-300 bg-white px-3 py-1 text-xs font-semibold text-olive-800 hover:bg-olive-50 disabled:opacity-50"
      >
        {stato === 'invio'
          ? 'Segno…'
          : totale > 0
            ? `Bonifico fatto · ${formatPrice(totale / 100)}${parziale ? ' (solo una parte)' : ''}`
            : `Segna la compensazione · nessun bonifico${parziale ? ' (solo una parte)' : ''}`}
      </button>
      {esito && <p role="status" className="mt-1 text-xs text-ink-600">{esito}</p>}
      {stato === 'errore' && (
        <p role="alert" className="mt-1 text-xs text-secondary-700">Non sono riuscito a segnarlo: riprova.</p>
      )}
    </div>
  );
}

const fmtGiorno = (g: string) => new Date(`${g}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

export default function AdminPayoutsPage() {
  const settimana = settimanaPrima(new Date());
  const query = useQuery({
    queryKey: ['admin', 'payouts'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<LettiPayout> => {
      // Solo ordini consegnati con un netto venditore calcolato: sono gli unici
      // rilevanti per la riconciliazione payout. Esclude carrelli/annullati.
      const consegnati = () =>
        supabase
          .from('orders')
          .select(
            'id, seller_id, total_price, seller_payout_cents, seller_payout_reversed_cents, application_fee_cents, wallet_applied_cents, dispute_status, internal_dispute_status, payment_status, payout_status, payout_at, stripe_transfer_id, delivery_status, payment_method, created_at, delivered_at, seller:profiles!orders_seller_id_fkey ( store_name, billing_iban )',
            // R11-011 — il server restituisce al massimo mille righe: la riga in più non arriva mai.
            { count: 'exact' },
          )
          .eq('delivery_status', 'DELIVERED')
          .not('seller_payout_cents', 'is', null);
      // R05-001 — il tetto vale per gli aperti da soli: i bonifici chiusi non li spingono più fuori.
      const [daPagabili, daAperti, daChiusi, daStorni] = await Promise.all([
        // R22-001 — i pagabili a parte, dal consegnato prima (poi id), col loro tetto.
        consegnati().or(PAGABILI).order('delivered_at', { ascending: true }).order('id', { ascending: true }).limit(TETTO_PAYOUT + 1),
        consegnati()
          .or(`payout_status.is.null,payout_status.not.in.(${STATI_CHIUSI.join(',')}),${RITIRO_DA_REGOLARE}`)
          // Dal più recente, come prima. R22-001 — oltre il tetto mancano le righe ferme più vecchie: i
          // contanti da versare e i ritiri da regolare vengono dalla loro lettura (daPagabili), non da qui.
          .order('created_at', { ascending: false })
          // Una riga in più: se arriva, l'elenco è tagliato davvero (con 1000 esatte no).
          .limit(TETTO_PAYOUT + 1),
        consegnati().in('payout_status', STATI_CHIUSI).order('created_at', { ascending: false }).limit(TETTO_PAYOUT + 1),
        // R22-001 — lo storno non riuscito è raro e va recuperato a mano: una lettura sua, non esce con i chiusi.
        consegnati().eq('payout_status', 'REVERSAL_FAILED').order('created_at', { ascending: false }).limit(TETTO_PAYOUT + 1),
      ]);
      for (const r of [daPagabili, daAperti, daChiusi, daStorni]) if (r.error) throw r.error;
      const { data, count } = daAperti;
      const contati = (r: { data: unknown; count?: number | null }) =>
        Math.max(typeof r.count === 'number' ? r.count : 0, Array.isArray(r.data) ? r.data.length : 0);
      // L'elenco resta un elenco; il totale contato dal database gli viaggia attaccato.
      const pagabili = ((daPagabili.data ?? []) as unknown as PayoutOrder[]).slice(0, TETTO_PAYOUT);
      const idPagabili = new Set(pagabili.map((o) => o.id));
      const righe = [
        ...pagabili,
        // I pagabili vengono solo dalla loro lettura: una finestra sola, senza buchi.
        ...((data ?? []) as unknown as PayoutOrder[]).slice(0, TETTO_PAYOUT).filter((o) => !idPagabili.has(o.id) && !pagabile(o)),
      ];
      const giaLetti = new Set(righe.map((o) => o.id));
      // R05-001 — un ritiro da regolare (CASH_IN_STORE senza payout_at) sta anche fra i chiusi: rimasto fuori
      // dalla finestra dei pagabili non rientra da qui, fuori finestra e senza il controllo di resi e reclami.
      const righeChiuse = [
        ...((daStorni.data ?? []) as unknown as PayoutOrder[]).slice(0, TETTO_PAYOUT),
        ...((daChiusi.data ?? []) as unknown as PayoutOrder[]).slice(0, TETTO_PAYOUT),
      ].filter((o) => !pagabile(o) && !giaLetti.has(o.id) && (giaLetti.add(o.id), true));
      const totaleChiusi = Math.max(typeof daChiusi.count === 'number' ? daChiusi.count : 0, daChiusi.data?.length ?? 0);
      // Collaudo K04 — resi e reclami aperti si leggono dalle loro tabelle, come fanno il giro e la
      // funzione 916: senza, un contante con un reso aperto entrava nei «Da versare», la funzione lo saltava
      // in silenzio e il lunedì dopo ricompariva, pagato due volte. Una lettura caduta li ferma tutti.
      // Anche i ritiri al banco da regolare: con un reso o un reclamo aperto la commissione aspetta (916).
      const contantiHeld = righe
        .filter((o) => o.payment_method === 'cod' && (o.payout_status === 'HELD' || (o.payout_status === 'CASH_IN_STORE' && !o.payout_at)))
        .map((o) => o.id);
      const aperti = new Set<string>();
      let letturaCaduta = false;
      for (let i = 0; i < contantiHeld.length; i += 150) {
        const pezzo = contantiHeld.slice(i, i + 150);
        const [resi, reclami] = await Promise.all([
          supabase.from('returns').select('order_id').in('order_id', pezzo).in('status', ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED']),
          supabase.from('disputes').select('order_id').in('order_id', pezzo).in('status', ['open', 'under_review']),
        ]);
        if (resi.error || reclami.error) letturaCaduta = true;
        for (const r of [...((resi.data ?? []) as { order_id: string }[]), ...((reclami.data ?? []) as { order_id: string }[])]) aperti.add(r.order_id);
      }
      const daControllare = new Set(contantiHeld);
      for (const o of righe) {
        if (letturaCaduta ? daControllare.has(o.id) : aperti.has(o.id)) o.pratica_aperta = true;
      }
      return Object.assign(righe, {
        totale: typeof count === 'number' ? count : righe.length,
        chiusi: righeChiuse,
        totaleChiusi,
        tagliato: contati(daAperti) > TETTO_PAYOUT,
        tagliatoPagabili: contati(daPagabili) > TETTO_PAYOUT,
      });
    },
  });
  const { data: letti = [], refetch } = query;
  // R22-002 — Le letture dei bonifici a mano partono solo se fra gli ordini letti (aperti e chiusi) ce n'è
  // una traccia: un contante segnato PAID_MANUALLY, o un contante / ritiro al banco con payout_at e senza
  // bonifico Stripe. Senza traccia non c'è niente da sommare e nessuna chiamata parte. Limite: un bonifico a
  // mano i cui ordini sono tutti fuori dalla finestra dei chiusi (oltre i mille più recenti) non si somma.
  const servonoManuali = useMemo(
    () =>
      [...letti, ...((letti as LettiPayout).chiusi ?? [])].some(
        (o) =>
          o.payout_status === 'PAID_MANUALLY' ||
          (!!o.payout_at && o.payout_status !== 'TRANSFERRED' && !o.stripe_transfer_id && (o.payment_method === 'cod' || o.payout_status === 'CASH_IN_STORE')),
      ),
    [letti],
  );
  // I bonifici fatti a mano, sommati per negozio e mese: l'importo partito davvero (al netto della
  // commissione trattenuta) e il resto in fattura. Se non si leggono (errore, eccezione, esito che non è
  // un elenco), «Già pagato» è un minimo: la pagina non cade.
  const manuali = useQuery({
    queryKey: ['admin', 'payouts', 'bonifici-manuali'],
    enabled: servonoManuali,
    refetchInterval: 60_000,
    queryFn: async (): Promise<BonificiDelMese[]> => {
      const { data, error } = await supabase.rpc('bonifici_manuali_per_mese');
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('bonifici a mano: esito non previsto');
      return data as BonificiDelMese[];
    },
  });
  const manualiLetti = !servonoManuali || (manuali.isSuccess && Array.isArray(manuali.data));
  const righeManuali = useMemo(
    () =>
      (servonoManuali && Array.isArray(manuali.data) ? (manuali.data as Partial<BonificiDelMese>[]) : []).map((r) => ({
        seller_id: String(r?.seller_id ?? ''),
        mese: String(r?.mese ?? ''),
        importo_cents: centesimi(r?.importo_cents),
        in_fattura_cents: centesimi(r?.in_fattura_cents),
      })),
    [servonoManuali, manuali.data],
  );
  // R22-003 — Contanti già versati a mano e poi rimborsati al cliente: il bonifico è partito, la quota
  // del negozio non si toglie più da un bonifico futuro. Va ripresa dal negozio: la pagina la mostra.
  // Si legge solo se c'è un bonifico a mano, cioè la stessa traccia di sopra: un contante versato a mano
  // tiene payout_at anche dopo il rimborso. Errore, eccezione o esito che non è un elenco: l'avviso.
  const recuperi = useQuery({
    queryKey: ['admin', 'payouts', 'da-recuperare'],
    enabled: servonoManuali,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DaRecuperare[]> => {
      const { data, error } = await supabase.rpc('contanti_da_recuperare');
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('quote da recuperare: esito non previsto');
      return (data as (Partial<DaRecuperare> | null)[]).map((r) => ({
        order_id: String(r?.order_id ?? ''),
        seller_id: String(r?.seller_id ?? ''),
        store_name: r?.store_name ?? null,
        da_recuperare_cents: centesimi(r?.da_recuperare_cents),
      }));
    },
  });
  const righeRecuperi = useMemo(() => (servonoManuali ? (recuperi.data ?? []) : []), [servonoManuali, recuperi.data]);
  // R05-002 — Da quando i contanti li paga Stripe: la variabile la legge solo il server.
  // Collaudo — finché non c'è nessuna lettura buona (in corso, o caduta) i contanti che Stripe potrebbe
  // pagare sono incerti: fuori da «Da versare» e dal tasto, con l'avviso. Una rilettura caduta dopo una
  // buona tiene l'ultima lettura buona (React Query la conserva): la variabile cambia solo col rilascio.
  const daStripe = useQuery({ queryKey: ['admin', 'payouts', 'contanti-da-stripe'], queryFn: leggiContantiDaStripe, refetchInterval: 60_000 });
  const stripeNonSo = daStripe.data === undefined;
  const inizioStripe = typeof daStripe.data === 'number' ? daStripe.data : null;
  const rileggi = () => {
    void refetch();
    // refetch() parte anche a lettura spenta: senza traccia di bonifici a mano non si chiama.
    if (servonoManuali) void manuali.refetch();
    if (servonoManuali) void recuperi.refetch();
  };

  const meta = letti as LettiPayout;
  const tagliato = meta.tagliato ?? Math.max(meta.totale ?? 0, letti.length) > TETTO_PAYOUT;
  // R22-001 — la cifra del lunedì e il tasto dipendono solo dai pagabili, letti a parte col loro tetto.
  const tagliatoPagabili = meta.tagliatoPagabili ?? tagliato;
  // R05-001 — i chiusi hanno il loro tetto: tagliati loro, è un minimo solo «già pagato».
  const tagliatoChiusi = meta.chiusi ? (meta.totaleChiusi ?? 0) > TETTO_PAYOUT : tagliato;
  const orders = useMemo(() => {
    const tutti = [...letti, ...((letti as LettiPayout).chiusi ?? [])].map((o) =>
      stripeNonSo && potrebbePagarloStripe(o) && !bonificoStripeAppeso(o)
        ? { ...o, stripe_incerto: true }
        : loPagaStripe(o, inizioStripe)
          ? { ...o, lo_paga_stripe: true }
          : o,
    );
    // Lo stesso ordine di prima, aperti e chiusi mescolati: il più recente in cima.
    return tutti.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }, [letti, inizioStripe, stripeNonSo]);
  // R05-002 (collaudo) — quanto resta fuori da «Da versare» perché non si sa se lo paga Stripe.
  const incertiCents = useMemo(() => orders.reduce((s, o) => s + (o.stripe_incerto ? netto(o) : 0), 0), [orders]);
  // Con l'elenco tagliato ogni somma è un minimo, non il totale.
  const almeno = tagliato ? 'almeno ' : '';
  const almenoDovuto = tagliatoPagabili ? 'almeno ' : '';
  const almenoPagati = tagliatoChiusi || !manualiLetti ? 'almeno ' : '';

  const groups = useMemo(() => {
    const map = new Map<string, SellerGroup>();
    const gruppo = (sellerId: string, storeName: string | null | undefined, iban: string | null): SellerGroup => {
      const g = map.get(sellerId) ?? {
        sellerId,
        storeName: storeName ?? `Venditore ${sellerId.slice(0, 6)}`,
        iban,
        orders: [],
        dueCents: 0,
        lunediCents: 0,
        settimanaCents: 0,
        lunedi: conto([], []),
        holdCents: 0,
        paidCents: 0,
        inFattura: [],
        recuperoCents: 0,
        recuperoOrdini: 0,
      };
      map.set(sellerId, g);
      return g;
    };
    for (const o of orders) {
      if (!o.seller_id) continue;
      const g = gruppo(o.seller_id, o.seller?.store_name, o.seller?.billing_iban ?? null);
      g.orders.push(o);
      const cents = netto(o);
      const t = payoutTone(o);
      // R22-002 — i bonifici a mano si contano da quello che è partito (righeManuali), non dal netto pieno.
      if (t.tone === 'paid' && o.payout_status === 'TRANSFERRED') g.paidCents += cents;
      else if (t.tone === 'hold') g.holdCents += cents;
    }
    // Un negozio con solo una quota da recuperare compare lo stesso: i suoi ordini possono essere fuori elenco.
    for (const r of righeRecuperi) {
      if (!r.seller_id || r.da_recuperare_cents <= 0) continue;
      const g = gruppo(r.seller_id, r.store_name, null);
      g.recuperoCents += r.da_recuperare_cents;
      g.recuperoOrdini += 1;
    }
    const adesso = new Date();
    const mese = meseDiRoma(adesso);
    const [anno, m] = mese.split('-').map(Number);
    const mesePrima = m === 1 ? `${anno - 1}-12` : `${anno}-${String(m - 1).padStart(2, '0')}`;
    for (const g of map.values()) {
      g.lunedi = contoDelLunedi(g.orders, adesso);
      g.lunediCents = g.lunedi.importoCents;
      g.settimanaCents = contoDiQuestaSettimana(g.orders, adesso).importoCents;
      g.dueCents = g.lunediCents + g.settimanaCents;
      for (const r of righeManuali.filter((x) => x.seller_id === g.sellerId)) {
        g.paidCents += r.importo_cents;
        if (r.in_fattura_cents > 0 && (r.mese === mese || r.mese === mesePrima)) g.inFattura.push({ mese: r.mese, cents: r.in_fattura_cents });
      }
    }
    // Ordina: prima chi ha più da liquidare.
    return Array.from(map.values()).sort((a, b) => b.lunediCents - a.lunediCents || b.dueCents - a.dueCents);
  }, [orders, righeManuali, righeRecuperi]);

  const totals = useMemo(() => {
    let hold = 0;
    let paid = 0;
    for (const o of orders) {
      const cents = netto(o);
      const t = payoutTone(o);
      if (t.tone === 'hold') hold += cents;
      else if (o.payout_status === 'TRANSFERRED') paid += cents;
    }
    // R22-002 — da versare: ogni negozio meno la sua commissione dei ritiri al banco; già pagato: quello
    // partito davvero, cioè i bonifici della carta e i bonifici a mano al netto della trattenuta.
    const due = groups.reduce((s, g) => s + g.dueCents, 0);
    paid += righeManuali.reduce((s, r) => s + r.importo_cents, 0);
    return { dueCents: due, holdCents: hold, paidCents: paid };
  }, [orders, groups, righeManuali]);

  // Scheletro, errore e vuoto li decide il presidio comune (lib/vista-query.ts), come nel cruscotto
  // di oggi: una lettura ferma senza dato non diventa «nessun payout» con i riquadri a zero.
  const vista = vistaDaQuery(query, { quanti: groups.length });
  if (vista.mostraScheletro) return <LoadingState />;

  // Lettura caduta: niente riquadri a 0,00 € ne' «nessun payout». Un importo non letto non si mostra.
  if (vista.mostraErrore) {
    return (
      <div className="space-y-6">
        <AdminPageTitle eyebrow="Trust & Safety" title="Payout venditori" />
        <ErrorState
          variant="compact"
          title="Non riesco a leggere i payout dei negozi"
          description="Non so quanto c’è da pagare ai negozi né cosa è già stato pagato. Riprova tra poco."
          retry={() => void refetch()}
          supportHref={null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Trust & Safety"
        title="Payout venditori"
        sub={
          CARTA_ACCESA
            ? 'Quanto versare a ogni negozio. Carta: parte in automatico ~1h dopo la consegna. Contanti: il bonifico lo fai tu il lunedì, per le consegne della settimana prima.'
            : 'Quanto versare a ogni negozio. Al lancio si paga solo in contanti: il bonifico lo fai tu il lunedì, per le consegne della settimana prima.'
        }
      />

      {/* L'avviso viene PRIMA dei riquadri: chi legge solo il numero deve già sapere che è parziale. */}
      {(tagliato || tagliatoPagabili || tagliatoChiusi) && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="space-y-1">
            {tagliato && (
              <p>
                <strong>Elenco tagliato:</strong> mostro solo gli ultimi {TETTO_PAYOUT} ordini consegnati ancora da chiudere (bonifico aperto
                o ritiro al banco da regolare). Mancano i più
                vecchi fra quelli fermi (dal fattorino, con un reclamo, senza IBAN); i contanti da versare si leggono a parte. I totali
                di questa pagina, anche quelli dei singoli negozi, possono essere più bassi del vero.
              </p>
            )}
            {/* R22-001 — i contanti da versare hanno il loro tetto: tagliati loro, la cifra del lunedì è una parte. */}
            {tagliatoPagabili && (
              <p>
                <strong>Contanti da versare oltre {TETTO_PAYOUT}:</strong> mostro i consegnati prima. La cifra da versare e il tasto
                «Bonifico fatto» sono solo una parte del dovuto: dopo il bonifico ricarica la pagina per il resto.
              </p>
            )}
            {/* I chiusi hanno il loro tetto: oltre, l'elenco dei pagati si taglia e «Già pagato» è un minimo. */}
            {tagliatoChiusi && (
              <p>
                <strong>Ordini già chiusi oltre {TETTO_PAYOUT}:</strong> nell&apos;elenco ci sono solo gli ultimi {TETTO_PAYOUT} (pagati,
                rimborsati, stornati). Mancano i più vecchi: «Già pagato» è un minimo.
              </p>
            )}
          </div>
        </div>
      )}

      {servonoManuali && recuperi.isError && (
        <p role="alert" className="text-sm text-secondary-700">
          Non riesco a leggere i contanti da recuperare dai negozi (rimborsi arrivati dopo un bonifico a mano). Riprova tra poco.
        </p>
      )}

      {/* R05-002 (collaudo) — senza nessuna lettura buona i contanti che Stripe potrebbe pagare non si contano e non si segnano. */}
      {stripeNonSo && daStripe.isError && (
        <p role="alert" className="text-sm font-semibold text-secondary-700">
          Non so da quando i contanti li paga Stripe (PAGAMENTI_CONTANTI_DA_STRIPE_DAL): se è accesa, i contanti consegnati da
          quel giorno li paga il giro e versati a mano sarebbero pagati due volte. Per questo{' '}
          {incertiCents > 0 ? `${almeno}${formatPrice(incertiCents / 100)} di contanti restano` : 'i contanti restano'} «In sospeso»,
          fuori da «Contanti da versare», e il tasto «Bonifico fatto» è fermo per quei negozi. Riprova tra poco.
        </p>
      )}
      {stripeNonSo && !daStripe.isError && incertiCents > 0 && (
        <p role="status" className="text-sm text-ink-600">
          Controllo da quando i contanti li paga Stripe: intanto {almeno}{formatPrice(incertiCents / 100)} di contanti restano «In sospeso» e
          il tasto «Bonifico fatto» aspetta.
        </p>
      )}
      {!stripeNonSo && daStripe.isError && (
        <p role="status" className="text-sm text-ink-600">
          Non riesco a rileggere da quando i contanti li paga Stripe: uso l&apos;ultima lettura buona.
        </p>
      )}

      {/* KPI: pronto · in sospeso · già pagato */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <AdminStatCard icon={Banknote} tone="olive" label="Contanti da versare" value={`${almenoDovuto}${formatPrice(totals.dueCents / 100)}`} />
        <AdminStatCard icon={Clock} tone="accent" label="In sospeso" value={`${almeno}${formatPrice(totals.holdCents / 100)}`} />
        <AdminStatCard icon={CheckCircle2} tone="primary" label="Già pagato" value={`${almenoPagati}${formatPrice(totals.paidCents / 100)}`} />
      </div>

      {/* R11-001 — La nota diceva «niente azioni manuali»: al lancio i contanti li versi tu. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          {/* R22-002 — «automatico» solo con la carta accesa: al lancio ogni bonifico lo fai tu. */}
          {CARTA_ACCESA && (
            <>
              Carta: i bonifici li fa il giro <span className="font-mono text-xs">release-payouts</span> verso il conto Stripe
              del negozio.{' '}
            </>
          )}
          Contanti: il lunedì versi tu, con un bonifico, quanto c&apos;è scritto in «Da versare lunedì»
          (consegne dal {fmtGiorno(settimana.dal)} al {fmtGiorno(settimana.al)} e arretrati), poi premi «Bonifico fatto».
          Gli importi sono già al netto degli storni e della commissione dei ritiri pagati al banco: se la commissione
          supera i contanti, il resto va nella fattura del mese.
          {/* R05-002 — con PAGAMENTI_CONTANTI_DA_STRIPE_DAL valida quei contanti li paga il giro, non tu. */}
          {inizioStripe !== null && (
            <>
              {' '}I contanti consegnati dal{' '}
              {new Date(inizioStripe).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })} li
              paga Stripe: sono «In sospeso · lo paga Stripe», non li versi tu.
            </>
          )}
        </p>
      </div>

      {vista.mostraVuoto ? (
        <div className="rounded-2xl border-2 border-cream-300 bg-white p-12 text-center">
          <CheckCircle2 size={40} strokeWidth={2} className="mx-auto mb-2 text-olive-500" aria-hidden />
          <p className="font-medium text-ink-600">Nessun payout da riconciliare</p>
          <p className="mt-1 text-sm text-ink-400">Gli ordini consegnati compariranno qui con il loro netto venditore.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.sellerId} className="overflow-hidden rounded-2xl border-2 border-cream-300 bg-white shadow-warm">
              {/* Intestazione negozio: nome + IBAN mono + riepilogo */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-200 bg-cream-50 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700">
                    <Store size={19} strokeWidth={2.2} aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold text-ink-900">{g.storeName}</p>
                    <p className="font-mono text-xs text-ink-500 select-all" title={maskIban(g.iban) ?? undefined}>
                      {g.iban ? g.iban.replace(/\s+/g, '') : 'IBAN non impostato'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-400">Da versare lunedì</p>
                  <p className="font-mono text-lg font-extrabold text-olive-700">{almenoDovuto}{formatPrice(g.lunediCents / 100)}</p>
                  {(g.lunedi.trattenutaCents > 0 || g.lunedi.creditoCents > 0) && (
                    <p className="text-xs text-ink-500">
                      contanti {formatPrice(g.lunedi.contantiCents / 100)}
                      {g.lunedi.creditoCents > 0 && ` + ${formatPrice(g.lunedi.creditoCents / 100)} di credito MyCity dei ritiri al banco`}
                      {g.lunedi.trattenutaCents > 0 && ` − ${formatPrice(g.lunedi.trattenutaCents / 100)} di commissione dei ritiri al banco`}
                    </p>
                  )}
                  {g.lunedi.inFatturaCents > 0 && (
                    <p className="text-xs text-secondary-700">
                      {formatPrice(g.lunedi.inFatturaCents / 100)} di commissione non entrano nel bonifico: vanno nella fattura del mese
                    </p>
                  )}
                  {g.settimanaCents > 0 && (
                    <p className="text-xs text-ink-500">+ {almenoDovuto}{formatPrice(g.settimanaCents / 100)} di questa settimana</p>
                  )}
                  {g.holdCents > 0 && (
                    <p className="text-xs text-ink-500">{almeno}{formatPrice(g.holdCents / 100)} in sospeso</p>
                  )}
                  {/* R11-012 (collaudo K04) — anche le cifre del singolo negozio sono un minimo, con l'elenco tagliato. */}
                  {g.paidCents > 0 && (
                    <p className="text-xs text-ink-500">{almenoPagati}{formatPrice(g.paidCents / 100)} già pagati</p>
                  )}
                  {/* R22-003 — Non si toglie dal bonifico del lunedì: si riprende dal negozio, a mano. */}
                  {g.recuperoCents > 0 && (
                    <p className="text-xs font-semibold text-secondary-700">
                      Da recuperare dal negozio: {formatPrice(g.recuperoCents / 100)} ({g.recuperoOrdini}{' '}
                      {g.recuperoOrdini === 1 ? 'ordine rimborsato' : 'ordini rimborsati'} dopo il bonifico a mano). Non è tolto
                      dal bonifico del lunedì: chiedilo al negozio.
                    </p>
                  )}
                  {g.inFattura.map((f) => (
                    <p key={f.mese} className="text-xs text-secondary-700">
                      {formatPrice(f.cents / 100)} di commissione in fattura ({nomeDelMese(f.mese)})
                    </p>
                  ))}
                  <BonificoFatto sellerId={g.sellerId} storeName={g.storeName} ordini={g.orders} quandoFatto={rileggi} parziale={tagliatoPagabili} />
                </div>
              </div>

              {/* Righe ordini del venditore */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white text-xs uppercase tracking-[0.03em] text-ink-500">
                      <th className="px-5 py-2.5 text-left font-bold">Ordine</th>
                      <th className="px-5 py-2.5 text-left font-bold">Consegnato</th>
                      <th className="px-5 py-2.5 text-left font-bold">Metodo</th>
                      <th className="px-5 py-2.5 text-right font-bold">Netto</th>
                      <th className="px-5 py-2.5 text-right font-bold">Stato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cream-100">
                    {g.orders.map((o) => {
                      const t = payoutTone(o);
                      return (
                        <tr key={o.id} className="hover:bg-cream-50">
                          <td className="px-5 py-3">
                            <Link
                              href={`/admin/orders/${o.id}`}
                              className="font-mono text-xs text-primary-700 hover:underline"
                            >
                              #{o.id.slice(0, 6).toUpperCase()}
                            </Link>
                          </td>
                          <td className="px-5 py-3 text-xs text-ink-500">{o.delivered_at ? fmtDate(o.delivered_at) : '—'}</td>
                          <td className="px-5 py-3 text-xs text-ink-600">
                            {o.payment_method === 'cod' ? 'Contanti' : 'Carta'}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-ink-900">
                            {formatPrice(netto(o) / 100)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={`${t.cls} inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold`}>
                              {t.label}
                            </span>
                            {o.stripe_transfer_id && (
                              <span className="mt-0.5 block font-mono text-2xs text-ink-400">
                                {o.stripe_transfer_id.slice(0, 14)}…
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
