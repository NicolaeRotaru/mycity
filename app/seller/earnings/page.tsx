'use client';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { Landmark, Info, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { vistaDaQuery } from '@/lib/vista-query';
import { Card } from '@/components/ui/Card';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';
import { riepilogoNegozio, riepilogoContanti } from '@/lib/guadagni/negozio';
import { incassoPerGiorno } from '@/lib/guadagni/giorni';
import { TETTO_ORDINI_LETTI, avvisoDelTettoOrdini } from '@/lib/guadagni/tetto-ordini';
import { spiegazioneCommissione } from './commissione';
import StripeConnectButton from '@/components/seller/StripeConnectButton';
import StripeDashboardButton from '@/components/seller/StripeDashboardButton';
import { CARTA_ACCESA } from '@/lib/funzioni-al-lancio';

type PeriodKey = '7d' | '30d' | '90d' | 'all';

const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '7d',  label: '7 giorni',  days: 7 },
  { key: '30d', label: '30 giorni', days: 30 },
  { key: '90d', label: '90 giorni', days: 90 },
  { key: 'all', label: 'Tutto',     days: null },
];

type OrderRow = {
  id: string;
  total_price: number;
  created_at: string;
  delivery_status: string;
  payment_method: string | null;
  payment_status: string | null;
  payout_status: string | null;
  payout_at: string | null;
  seller_payout_cents: number | null;
  seller_payout_reversed_cents: number | null;
  refunded_amount_cents: number | null;
  application_fee_cents: number | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  pickup_in_store: boolean | null;
  wallet_applied_cents: number | null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** Badge stato payout reale (da orders.payout_status). */
function payoutBadge(o: OrderRow): { label: string; cls: string } {
  // 22/8/2026 — «Contanti» era la targhetta di TUTTI gli ordini in
  // contrassegno, qualunque cosa fosse successo ai soldi: in attesa della
  // cassa del fattorino, in liquidazione, gia' pagato o stornato erano
  // indistinguibili. Il negoziante non aveva modo di sapere se un pagamento
  // era partito. Ora ogni stato ha il suo nome.
  if (o.payment_method === 'cod') {
    switch (o.payout_status) {
      case 'TRANSFERRED':
      case 'PAID_MANUALLY': // R11-004 — il bonifico del lunedì fatto a mano
        return { label: o.payout_at ? `Pagato ${fmtDate(o.payout_at)}` : 'Pagato', cls: 'bg-olive-100 text-olive-800' };
      case 'AWAITING_REMITTANCE':
        return { label: 'Attesa cassa fattorino', cls: 'bg-accent-100 text-accent-800' };
      case 'CASH_IN_STORE': // R11-005 — ritiro pagato al banco: nessun bonifico
        return { label: 'Incassato al banco', cls: 'bg-cream-200 text-ink-700' };
      case 'HELD':
      case 'PROCESSING':
        return { label: 'In liquidazione', cls: 'bg-accent-100 text-accent-800' };
      case 'REVERSED':
        return { label: 'Stornato', cls: 'bg-secondary-100 text-secondary-700' };
      case 'REFUNDED':
        return { label: 'Rimborsato', cls: 'bg-secondary-100 text-secondary-700' };
      default:
        return { label: 'Contanti', cls: 'bg-cream-200 text-ink-700' };
    }
  }
  switch (o.payout_status) {
    case 'TRANSFERRED':
      return { label: o.payout_at ? `Pagato ${fmtDate(o.payout_at)}` : 'Pagato', cls: 'bg-olive-100 text-olive-800' };
    case 'HELD':
      return { label: 'In attesa', cls: 'bg-accent-100 text-accent-800' };
    case 'PENDING_SELLER_ONBOARDING':
      return { label: 'Collega il conto', cls: 'bg-primary-100 text-primary-800' };
    case 'REVERSAL_FAILED': // R11-013 — prima usciva il codice grezzo
      return { label: 'Storno da sistemare: ci pensiamo noi', cls: 'bg-secondary-100 text-secondary-700' };
    case 'PROCESSING':
      return { label: 'Bonifico in corso', cls: 'bg-accent-100 text-accent-800' };
    case 'REVERSED':
      return { label: 'Stornato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'REFUNDED':
      return { label: 'Rimborsato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'FAILED':
      return { label: 'Verifica IBAN', cls: 'bg-secondary-100 text-secondary-700' };
    default:
      // R11-013 — mai il codice tecnico a video: una parola sola.
      return { label: o.payout_status ? 'Da verificare' : '—', cls: 'bg-cream-200 text-ink-700' };
  }
}

/** Quando arrivano i soldi: la stessa frase della spiegazione della commissione. */
const tempiBonifico = spiegazioneCommissione().find((p) => p.tema === 'bonifico');

/** R17-001 — Con la carta spenta tutto quello che aspetta è contanti: lo versiamo il lunedì. */
const inAttesa = CARTA_ACCESA ? 'in attesa del bonifico' : 'in attesa del bonifico del lunedì';

export default function SellerEarningsPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');

  // Prima qui c'era `const { data: orders = [], isLoading }`. Quel `= []` è il difetto: quando la
  // lettura fallisce React Query lascia `data` a undefined, il ripiego prende il suo posto e la
  // pagina disegna la torre dei numeri a zero con la riga «Ancora nessun ordine pagato con carta» —
  // a un negoziante che gli ordini li ha. La lettura adesso si tiene INTERA e il verdetto lo dà
  // `vistaDaQuery`, che l'errore non lo può perdere per strada.
  const query = useQuery({
    queryKey: queryKeys.seller.earnings,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('orders')
        .select(
          // 060 — `seller_payout_reversed_cents` e `payment_status` non erano
          // nemmeno letti: senza il primo un ordine parzialmente stornato
          // entrava per intero nell'incassato, senza il secondo un ordine
          // parzialmente rimborsato contava pieno nel lordo. Il negoziante
          // vedeva un numero piu' alto di quello arrivato sull'IBAN, e quando
          // lo confrontava con la sua dashboard Stripe i conti non tornavano.
          // E' la telefonata «dove sono i miei soldi», che sul payout erode la
          // fiducia piu' di qualunque altra cosa.
          // R17-001 — `wallet_applied_cents`: nei contanti `total_price` è scritto dopo il credito MyCity.
          'id, total_price, created_at, delivery_status, payment_method, payment_status, payout_status, payout_at, seller_payout_cents, seller_payout_reversed_cents, refunded_amount_cents, application_fee_cents, stripe_transfer_id, stripe_reversal_id, pickup_in_store, wallet_applied_cents',
        )
        .eq('seller_id', user.id)
        // #90 — Un tetto esplicito. Queste pagine leggevano la tabella intera:
        // finche' gli ordini sono cento non si nota, il giorno che sono
        // diecimila la pagina non si apre piu' — cioe' proprio quando serve.
        // Il tetto e' dichiarato qui e mostrato a chi guarda, invece di essere
        // il limite implicito di mille righe di PostgREST, che taglia in
        // silenzio e fa sembrare veri dei numeri che non lo sono.
        .order('created_at', { ascending: false })
          .limit(TETTO_ORDINI_LETTI);
      if (error) throw error;
      return (data ?? []) as unknown as OrderRow[];
    },
  });
  // R11-003 — Senza IBAN il bonifico non può partire: lo si dice qui, con la strada per scriverlo.
  const queryIban = useQuery({
    queryKey: ['seller', 'iban-per-i-bonifici'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from('profiles').select('billing_iban').eq('id', user.id).maybeSingle();
      // Una lettura caduta non è «IBAN mancante»: niente avviso, la query resta in errore.
      if (error) throw error;
      return (data as { billing_iban?: string | null } | null)?.billing_iban ?? null;
    },
  });
  const ibanMancante = queryIban.isSuccess && !queryIban.data;

  // Per i calcoli serve una lista: qui il ripiego è innocuo, perché a decidere COSA disegnare non è
  // più questa riga ma il verdetto qui sotto.
  const orders = query.data ?? [];

  const filtered = useMemo(() => {
    const conf = PERIODS.find((p) => p.key === period)!;
    if (!conf.days) return orders;
    const cutoff = Date.now() - conf.days * 86400000;
    return orders.filter((o) => new Date(o.created_at).getTime() >= cutoff);
  }, [orders, period]);

  // R17-001 — Lo storico elenca anche i contanti, col loro stato: al lancio sono tutti gli ordini.
  // Un contrassegno ci entra da consegnato: prima nessuno ha ancora pagato niente.
  const storico = useMemo(
    () => filtered.filter((o) => o.payment_method !== 'cod' || o.delivery_status === 'DELIVERED'),
    [filtered],
  );

  // I conti stanno in lib/guadagni/negozio.ts: sono soldi di una persona e
  // vanno provati fuori dal componente (#60).
  // R17-001 — Carta e contanti: con i soli contanti la torre diceva commissione zero.
  const riepilogo = useMemo(() => riepilogoNegozio(filtered), [filtered]);
  const grossCents = riepilogo.lordoCents;
  const feeCents = riepilogo.commissioniCents;
  const nettoCents = riepilogo.nettoCents;
  const heldCents = riepilogo.inArrivoCents;
  const paidCents = riepilogo.versatiCents;
  const stornatiCents = riepilogo.stornatiCents;

  // Contanti (COD): ordini pagati alla consegna e consegnati nel periodo.
  //
  // 22/8/2026 — QUI SI MOSTRAVA IL TOTALE DEL CLIENTE COL NOME DEL NETTO.
  // La somma era `total_price`, cioe' il contante che il cliente mette in mano
  // al fattorino: dentro ci sono i 3 euro di consegna, la spedizione e la
  // commissione del 10%. Il negoziante leggeva una cifra piu' alta di quella
  // che gli sarebbe arrivata, e non c'era scritto da nessuna parte che fossero
  // due numeri diversi.
  const contanti = useMemo(
    () => riepilogoContanti(filtered, (o) => (o as OrderRow).delivery_status === 'DELIVERED'),
    [filtered],
  );

  // Mini-grafico ultimi 7 giorni (incasso lordo carta per giorno).
  //
  // 27/8/2026 (R174) — I giorni si tagliavano a mezzanotte di Greenwich: gli
  // ordini fatti fra mezzanotte e le due finivano nella colonna del giorno
  // prima, e lo stesso ordine compariva in due giorni diversi a seconda della
  // pagina che il negoziante apriva. Il conto adesso sta in un file suo, con la
  // sua prova, e usa l'orologio di Piacenza come tutte le altre pagine.
  // 5/11/2026 — Solo gli ordini attivi, come il riquadro del lordo: un ordine
  // annullato o rimborsato non e' incasso di nessun giorno.
  // R17-001 — Gli stessi ordini del lordo, contanti compresi: con la sola carta il grafico restava piatto.
  // Il nome resta activeCard (gli ordini attivi) perché lo legge la prova comune minori-s01-numeri-del-negozio.
  const activeCard = riepilogo.contati;
  const daily = useMemo(() => incassoPerGiorno(activeCard), [activeCard]);
  const maxDaily = Math.max(...daily.map(([, v]) => v), 1);

  const vista = vistaDaQuery(query);
  if (vista.mostraScheletro) return <LoadingState />;
  if (vista.mostraErrore) {
    return (
      <div>
        <SellerPageTitle eyebrow="Portafoglio" title="Guadagni" sub="Incassi reali dai tuoi ordini e stato dei bonifici" />
        <ErrorState
          title="Non sono riuscito a leggere i tuoi ordini"
          description="La lettura non è riuscita, quindi non so quanto hai incassato. Non vuol dire che non hai incassato niente: riprova fra un momento."
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      <SellerPageTitle eyebrow="Portafoglio" title="Guadagni" sub="Incassi reali dai tuoi ordini e stato dei bonifici" />
      {avvisoDelTettoOrdini(orders.length) && (
        <p role="note" className="mb-4 text-xs text-ink-500">{avvisoDelTettoOrdini(orders.length)}</p>
      )}

      {ibanMancante && (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Manca il tuo IBAN:</strong> senza, i bonifici dei tuoi ordini non possono partire.{' '}
          <Link href="/seller/profile#bonifici" className="font-semibold underline">Scrivilo nel profilo</Link>.
        </div>
      )}

      {/* Period switcher */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((p) => {
          const on = period === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              aria-pressed={on}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                on ? 'bg-primary-700 text-white' : 'bg-white text-ink-700 ring-1 ring-inset ring-cream-300 hover:bg-cream-50'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* KPI tower */}
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          label="Fatturato lordo"
          value={formatPrice(grossCents / 100)}
          hint={`${riepilogo.ordiniContanti + riepilogo.ordiniCarta} ordini · ${riepilogo.ordiniContanti} in contanti, ${riepilogo.ordiniCarta} con carta`}
          tone="primary"
        />
        <Stat
          label="Commissione MyCity"
          value={'− ' + formatPrice(feeCents / 100)}
          hint={`Già tolta: a te ${formatPrice(nettoCents / 100)} netti`}
          tone="secondary"
        />
        <Stat
          label="Incassato"
          value={formatPrice(paidCents / 100)}
          hint={`${formatPrice(heldCents / 100)} ${inAttesa}${stornatiCents > 0 ? ` · ${formatPrice(stornatiCents / 100)} storni` : ''}`}
          tone="olive"
          highlight
        />
      </div>

      {/* Daily chart + COD cash card */}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card variant="bordered" padding="lg">
          <h2 className="mb-4 font-serif text-lg font-bold text-ink-900">Andamento ultimi 7 giorni</h2>
          {/* Per chi non vede le barre: gli stessi valori, in testo. */}
          <ul className="sr-only">
            {daily.map(([day, val]) => (
              <li key={day}>{new Date(day).toLocaleDateString('it', { weekday: 'long' })}: {formatPrice(val)}</li>
            ))}
          </ul>
          <div className="flex h-32 items-end gap-2.5" aria-hidden="true">
            {daily.map(([day, val]) => {
              const pct = (val / maxDaily) * 100;
              return (
                // R11-013 — h-full: senza un'altezza la colonna non dava riferimento al % della barra (0 px).
                <div key={day} className="flex h-full flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-gradient-to-b from-primary-400 to-secondary-600"
                      style={{ height: `${Math.max(pct, val > 0 ? 5 : 2)}%` }}
                      title={formatPrice(val)}
                    />
                  </div>
                  <span className="text-[10px] text-ink-500">
                    {new Date(day).toLocaleDateString('it', { weekday: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card variant="flat" padding="lg" className="border border-olive-200 bg-olive-50">
          <h2 className="flex items-center gap-2 font-serif text-[17px] font-bold text-olive-900">
            <Banknote size={19} className="text-olive-700" aria-hidden /> Contanti alla consegna
          </h2>
          <p className="mb-3 mt-1 text-[13px] leading-relaxed text-olive-800">
            Gli ordini pagati alla consegna li incassa il fattorino. Il bonifico parte dopo la verifica
            della sua cassa: non è a fine giornata, è quando la cassa torna e viene controllata.
          </p>
          <p className="font-serif text-3xl font-extrabold text-olive-900">
            {formatPrice(contanti.nettoAlNegozioCents / 100)}
          </p>
          <p className="mt-0.5 text-xs text-olive-700">
            è quello che arriva a te (già tolte consegna e commissione)
          </p>
          <p className="mt-2 text-xs text-olive-700">
            Contante raccolto dal fattorino: <strong>{formatPrice(contanti.incassatoDalFattorinoCents / 100)}</strong>
            {contanti.giaVersatoCents > 0 && (
              <> · già versato: <strong>{formatPrice(contanti.giaVersatoCents / 100)}</strong></>
            )}
          </p>
          {/* R11-005 — Il ritiro pagato al banco: i soldi li hai già tu, la commissione la devi a MyCity. */}
          {contanti.incassatoAlBancoCents > 0 && (
            <p className="mt-2 text-xs text-olive-700">
              Incassati da te al banco (ritiro in negozio): <strong>{formatPrice(contanti.incassatoAlBancoCents / 100)}</strong>
              {' '}· nessun bonifico per questi: su questi ritiri la commissione MyCity è di{' '}
              <strong>{formatPrice(contanti.commissioneDovutaCents / 100)}</strong>, e te la chiediamo noi.
            </p>
          )}
        </Card>
      </div>

      {/* Stato bonifici (reale) */}
      <Card variant="bordered" padding="lg" className="mt-5 border-olive-200 bg-gradient-to-br from-olive-50 to-olive-100">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mb-1 flex items-center gap-2 font-bold text-olive-900"><Landmark size={20} className="text-olive-600" aria-hidden /> Bonifici</h2>
            <p className="text-sm text-olive-800">
              <strong>{formatPrice(paidCents / 100)}</strong> già versati ·{' '}
              <strong>{formatPrice(heldCents / 100)}</strong> {inAttesa}
              {stornatiCents > 0 && (
                <> · <strong>{formatPrice(stornatiCents / 100)}</strong> tornati indietro per rimborsi o contestazioni</>
              )}.
            </p>
            <p className="mt-1 text-xs text-olive-700">
              {/* 31/10/2026 (ondata 4) — qui c'era «Pagamento automatico circa un'ora
                  dopo la consegna, verso l'IBAN»: un'ora dopo i soldi passano sul conto
                  Stripe del negozio, non in banca, e al lancio si paga in contanti col
                  bonifico del lunedì. La frase è la stessa della spiegazione qui sotto. */}
              {tempiBonifico && <>{tempiBonifico.prima}{tempiBonifico.forte}{tempiBonifico.dopo}{' '}</>}
              {/* R17-001 — Finché la carta è spenta i contanti non passano da Stripe: niente rimando lì. */}
              {CARTA_ACCESA && 'Per saldo e bonifici reali apri il tuo conto Stripe.'}
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <StripeConnectButton />
            {CARTA_ACCESA && <StripeDashboardButton />}
          </div>
        </div>
      </Card>

      {/* Storico pagamenti — tabella 4 colonne, ordine in mono */}
      <Card variant="bordered" padding="none" className="mt-5 overflow-hidden">
        <div className="border-b border-cream-200 px-5 py-4">
          <h2 className="font-serif text-[17px] font-bold text-ink-900">Storico pagamenti</h2>
          <p className="text-xs text-ink-500">Stato reale del bonifico per ogni ordine, carta e contanti</p>
        </div>
        {storico.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-400">Ancora nessun ordine pagato nel periodo selezionato.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-cream-50 text-xs uppercase tracking-[0.03em] text-ink-500">
                  <th className="px-3 py-3 text-left font-bold sm:px-5">Ordine</th>
                  <th className="hidden px-5 py-3 text-left font-bold sm:table-cell">Data</th>
                  <th className="px-3 py-3 text-right font-bold sm:px-5">Netto</th>
                  <th className="px-3 py-3 text-right font-bold sm:px-5">Stato</th>
                </tr>
              </thead>
              <tbody>
                {storico.slice(0, 30).map((o) => {
                  const badge = payoutBadge(o);
                  return (
                    <tr key={o.id} className="border-t border-cream-200">
                      {/* R11-013 — sul telefono la data va sotto il numero: la colonna Stato non esce più dallo schermo. */}
                      <td className="px-3 py-3 font-mono text-[13px] text-ink-700 sm:px-5">
                        #{o.id.slice(0, 8)}
                        <span className="block font-sans text-[11px] text-ink-500">{o.payment_method === 'cod' ? 'Contanti' : 'Carta'}</span>
                        <span className="block font-sans text-[11px] text-ink-500 sm:hidden">{fmtDate(o.created_at)}</span>
                      </td>
                      <td className="hidden px-5 py-3 text-[13px] text-ink-500 sm:table-cell">{fmtDate(o.created_at)}</td>
                      <td className="px-3 py-3 text-right font-serif text-[15px] font-bold text-olive-700 sm:px-5">{formatPrice((o.seller_payout_cents ?? 0) / 100)}</td>
                      <td className="px-3 py-3 text-right sm:px-5">
                        <span className={`${badge.cls} inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Info commissioni */}
      <details className="mt-5 rounded-xl border border-cream-300 bg-cream-50">
        <summary className="flex cursor-pointer items-center gap-2 p-4 font-semibold text-ink-700"><Info size={16} className="text-ink-500" aria-hidden /> Come funziona la commissione?</summary>
        <div className="space-y-2 px-4 pb-4 text-sm text-ink-600">
          {spiegazioneCommissione().map((p) => (
            <p key={p.forte}>
              {p.prima}<strong>{p.forte}</strong>{p.dopo}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

function Stat({
  label, value, hint, tone, highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: 'primary' | 'secondary' | 'olive';
  highlight?: boolean;
}) {
  const palette = {
    primary:   { bg: 'bg-primary-50',   text: 'text-primary-900',   border: 'border-primary-200'   },
    secondary: { bg: 'bg-secondary-50', text: 'text-secondary-700', border: 'border-secondary-200' },
    olive:     { bg: 'bg-olive-50',     text: 'text-olive-900',     border: 'border-olive-200'     },
  }[tone];
  return (
    <div className={`${palette.bg} ${highlight ? `border-2 ${palette.border} ring-2 ring-olive-300 ring-offset-2` : 'border border-transparent'} rounded-xl p-5`}>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-2 font-serif text-3xl font-extrabold ${palette.text}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
