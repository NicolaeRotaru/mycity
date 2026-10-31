'use client';

/**
 * 31/10/2026 — IL DETTAGLIO DI UN ORDINE PER L'AMMINISTRAZIONE.
 *
 * Questa pagina non esisteva. Eppure `/admin/orders/<id>` lo linkavano l'elenco ordini, «Oggi», i
 * bonifici e ogni allarme automatico mandato agli amministratori (il «[apri]» della mail): tutti
 * portavano a «pagina non trovata». Chi riceveva l'allarme «ordine fermo» non poteva vedere l'ordine.
 *
 * Gli stati sono quattro e si dicono separati: sto leggendo · non riesco a leggere (con «Riprova») ·
 * ordine che non c'è · ordine. «Non trovato» e «non raggiungibile» non sono la stessa cosa: con
 * `.maybeSingle()` la riga mancante torna `null`, il guasto di rete resta un errore vero.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { formatPrice, formatDate } from '@/lib/format';
import type { OrderStatus } from '@/lib/order-status';
import { OrderStatusBadge } from '@/components/ui/OrderStatusBadge';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { queryKeys } from '@/lib/queries/keys';
import { vistaDaQuery } from '@/lib/vista-query';
import type { Colonne, ColonneSalvo } from '@/lib/db-rows';

type Dettaglio = ColonneSalvo<
  'orders',
  | 'id' | 'user_id' | 'seller_id' | 'rider_id' | 'total_price' | 'shipping_cost' | 'discount_amount'
  | 'coupon_code' | 'payment_method' | 'payment_status' | 'delivery_status' | 'pickup_in_store'
  | 'delivery_slot' | 'created_at' | 'accepted_at' | 'ready_at' | 'picked_up_at' | 'delivered_at'
  | 'canceled_at' | 'delivery_full_name' | 'delivery_phone' | 'delivery_address' | 'delivery_city'
  | 'delivery_zip' | 'delivery_notes' | 'refunded_amount_cents' | 'payout_status' | 'dispute_status',
  { delivery_status: OrderStatus }
> & {
  seller: Colonne<'profiles', 'store_name'> | null;
  rider: Colonne<'profiles', 'full_name'> | null;
  order_items: Colonne<'order_items', 'id' | 'quantity' | 'unit_price' | 'product_name'>[] | null;
};

const COLONNE_DETTAGLIO = `
  id, user_id, seller_id, rider_id, total_price, shipping_cost, discount_amount, coupon_code,
  payment_method, payment_status, delivery_status, pickup_in_store, delivery_slot, created_at,
  accepted_at, ready_at, picked_up_at, delivered_at, canceled_at,
  delivery_full_name, delivery_phone, delivery_address, delivery_city, delivery_zip, delivery_notes,
  refunded_amount_cents, payout_status, dispute_status,
  seller:profiles!orders_seller_id_fkey ( store_name ),
  rider:profiles!orders_rider_id_fkey   ( full_name ),
  order_items ( id, quantity, unit_price, product_name )
`;

/** Un indirizzo con un id che non è un uuid non è un guasto: è un ordine che non c'è. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Riga({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-500">{etichetta}</dt>
      <dd className="text-right text-ink-800">{children}</dd>
    </div>
  );
}

export default function AdminOrderDetailPage() {
  const id = String(useParams<{ id: string }>()?.id ?? '');
  const qc = useQueryClient();

  const lettura = useQuery({
    queryKey: [...queryKeys.admin.orders, 'dettaglio', id],
    queryFn: async (): Promise<Dettaglio | null> => {
      if (!FORMA_UUID.test(id)) return null;
      const { data, error } = await supabase
        .from('orders')
        .select(COLONNE_DETTAGLIO)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Dettaglio | null;
    },
    refetchInterval: 60_000,
  });

  const annulla = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ reason: 'Ordine annullato dall’amministrazione' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Annullamento fallito');
      return data as { refundId: string | null };
    },
    onSuccess: (data) => {
      toast.success(data?.refundId ? 'Ordine annullato e rimborsato' : 'Ordine annullato');
      qc.invalidateQueries({ queryKey: queryKeys.admin.orders });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const vista = vistaDaQuery(lettura);
  const indietro = (
    <Link href="/admin/orders" className="text-sm font-semibold text-primary-700 hover:underline">
      ← Tutti gli ordini
    </Link>
  );

  if (vista.mostraErrore && lettura.data === undefined) {
    return (
      <div className="space-y-5">
        <AdminPageTitle eyebrow="Ordine" title="Dettaglio ordine" action={indietro} />
        <ErrorState
          title="Non riesco a leggere questo ordine"
          description="Non vuol dire che non esista: vuol dire che non l’ho potuto guardare. Riprova fra un momento."
          retry={() => { void lettura.refetch(); }}
          supportHref={null}
        />
      </div>
    );
  }
  if (lettura.data === undefined) return <LoadingState />;

  const o = lettura.data;
  if (o === null) {
    return (
      <div className="space-y-5">
        <AdminPageTitle eyebrow="Ordine" title="Ordine non trovato" action={indietro} />
        <p className="rounded-xl border bg-white p-6 text-sm text-ink-600">
          Ho cercato l’ordine con codice «{id}» e non c’è. Controlla il link, oppure cercalo dall’elenco.
        </p>
      </div>
    );
  }

  const righe = o.order_items ?? [];
  const codice = `#${o.id.slice(0, 6).toUpperCase()}`;
  const tappe: [string, string | null][] = [
    ['Creato', o.created_at],
    ['Accettato', o.accepted_at],
    ['Pronto', o.ready_at],
    ['Ritirato', o.picked_up_at],
    ['Consegnato', o.delivered_at],
    ['Annullato', o.canceled_at],
  ];

  return (
    <div className="space-y-5">
      <AdminPageTitle
        eyebrow="Ordine"
        title={codice}
        sub={o.created_at ? `Creato il ${formatDate(o.created_at)}` : undefined}
        action={indietro}
      />

      <div className="flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={o.delivery_status} />
        {o.delivery_status !== 'CANCELED' && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Annullare questo ordine? Se pagato con carta verrà rimborsato al cliente.')) {
                annulla.mutate();
              }
            }}
            disabled={annulla.isPending}
            className="text-sm font-semibold text-rose-700 hover:text-rose-900 hover:underline disabled:opacity-50"
          >
            {annulla.isPending ? 'Annullo…' : 'Annulla ordine'}
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-800">Chi</h2>
          <dl>
            <Riga etichetta="Negozio">{o.seller?.store_name ?? '—'}</Riga>
            <Riga etichetta="Cliente">{o.delivery_full_name ?? '—'}</Riga>
            <Riga etichetta="Telefono">{o.delivery_phone ?? '—'}</Riga>
            <Riga etichetta="Rider">{o.rider?.full_name ?? '—'}</Riga>
          </dl>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-800">Consegna</h2>
          <dl>
            <Riga etichetta="Modo">{o.pickup_in_store ? 'Ritiro in negozio' : 'Consegna a domicilio'}</Riga>
            <Riga etichetta="Indirizzo">
              {[o.delivery_address, o.delivery_zip, o.delivery_city].filter(Boolean).join(', ') || '—'}
            </Riga>
            <Riga etichetta="Fascia">{o.delivery_slot ?? '—'}</Riga>
            <Riga etichetta="Note">{o.delivery_notes ?? '—'}</Riga>
          </dl>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-800">Soldi</h2>
          <dl>
            <Riga etichetta="Totale">{formatPrice(o.total_price)}</Riga>
            <Riga etichetta="Spedizione">{o.shipping_cost == null ? '—' : formatPrice(o.shipping_cost)}</Riga>
            <Riga etichetta="Sconto">
              {o.discount_amount ? `${formatPrice(o.discount_amount)}${o.coupon_code ? ` (${o.coupon_code})` : ''}` : '—'}
            </Riga>
            <Riga etichetta="Pagamento">{o.payment_method ?? '—'} · {o.payment_status ?? '—'}</Riga>
            <Riga etichetta="Rimborsato">
              {o.refunded_amount_cents ? formatPrice(o.refunded_amount_cents / 100) : '—'}
            </Riga>
            <Riga etichetta="Bonifico al negozio">{o.payout_status ?? '—'}</Riga>
            <Riga etichetta="Contestazione">{o.dispute_status ?? '—'}</Riga>
          </dl>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-ink-800">Tappe</h2>
          <dl>
            {tappe.map(([nome, quando]) => (
              <Riga key={nome} etichetta={nome}>{quando ? formatDate(quando) : '—'}</Riga>
            ))}
          </dl>
        </section>
      </div>

      <section className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="border-b bg-cream-50 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Prodotto</th>
              <th className="p-3 text-right">Quantità</th>
              <th className="p-3 text-right">Prezzo</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 text-ink-700">{r.product_name ?? '—'}</td>
                <td className="p-3 text-right">{r.quantity}</td>
                <td className="p-3 text-right">{formatPrice(r.unit_price)}</td>
              </tr>
            ))}
            {righe.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-ink-400">
                  Nessun articolo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
