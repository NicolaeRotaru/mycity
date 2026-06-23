'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Banknote, Clock, CheckCircle2, Store, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle, AdminStatCard } from '@/components/admin/AdminUI';

/**
 * Payout venditori (admin · Trust & Safety) — SOLA LETTURA.
 *
 * Mostra lo stato reale dei bonifici ai venditori leggendo direttamente la
 * tabella `orders` (colonne payout: seller_payout_cents, payout_status,
 * payout_at, stripe_transfer_id) e raggruppando per venditore.
 *
 * IMPORTANTE: nessuna azione di pagamento qui. Il payout reale avviene in modo
 * automatico via cron `release-payouts` (carta: ~1h dopo la consegna; COD: dopo
 * la conferma rimessa contanti del rider). Questa pagina è una vista di
 * riconciliazione per il founder, coerente col mockup admin v2 (40-ops).
 *
 * Stati payout (orders.payout_status), allineati a app/seller/earnings:
 *  - HELD / PENDING_SELLER_ONBOARDING → "In sospeso" (in attesa del cron/onboarding)
 *  - TRANSFERRED                      → "Pagato"
 *  - REVERSED / REFUNDED / FAILED     → esclusi dai totali "da pagare"/"pagato"
 * Gli ordini consegnati ma non ancora HELD (es. card freschi pre-cron) appaiono
 * come "Pronto" quando seller_payout_cents è valorizzato.
 */

type PayoutOrder = {
  id: string;
  seller_id: string | null;
  total_price: number | string | null;
  seller_payout_cents: number | null;
  payout_status: string | null;
  payout_at: string | null;
  stripe_transfer_id: string | null;
  delivery_status: string | null;
  payment_method: string | null;
  created_at: string | null;
  seller: { store_name: string | null; billing_iban: string | null } | null;
};

type PayoutTone = 'ready' | 'hold' | 'paid';

/** Mappa lo stato payout dell'ordine a un tono brand display-only. */
function payoutTone(o: PayoutOrder): { tone: PayoutTone; label: string; cls: string } {
  switch (o.payout_status) {
    case 'TRANSFERRED':
      return { tone: 'paid', label: 'Pagato', cls: 'bg-cream-200 text-ink-600' };
    case 'HELD':
    case 'PENDING_SELLER_ONBOARDING':
      return { tone: 'hold', label: 'In sospeso', cls: 'bg-accent-100 text-accent-800' };
    case 'REVERSED':
      return { tone: 'paid', label: 'Stornato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'REFUNDED':
      return { tone: 'paid', label: 'Rimborsato', cls: 'bg-secondary-100 text-secondary-700' };
    case 'FAILED':
      return { tone: 'hold', label: 'Verifica IBAN', cls: 'bg-secondary-100 text-secondary-700' };
    default:
      // Consegnato, importo netto calcolato, ma non ancora rilasciato dal cron.
      return { tone: 'ready', label: 'Pronto', cls: 'bg-olive-100 text-olive-800' };
  }
}

type SellerGroup = {
  sellerId: string;
  storeName: string;
  iban: string | null;
  orders: PayoutOrder[];
  dueCents: number; // pronto + in sospeso (da liquidare)
  paidCents: number; // già trasferiti
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '—';

/** Maschera l'IBAN mostrando prefisso paese + ultime 4 (display, dato reale). */
function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, '');
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export default function AdminPayoutsPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['admin', 'payouts'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<PayoutOrder[]> => {
      // Solo ordini consegnati con un netto venditore calcolato: sono gli unici
      // rilevanti per la riconciliazione payout. Esclude carrelli/annullati.
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, seller_id, total_price, seller_payout_cents, payout_status, payout_at, stripe_transfer_id, delivery_status, payment_method, created_at, seller:profiles!orders_seller_id_fkey ( store_name, billing_iban )',
        )
        .eq('delivery_status', 'DELIVERED')
        .not('seller_payout_cents', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as PayoutOrder[];
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, SellerGroup>();
    for (const o of orders) {
      if (!o.seller_id) continue;
      const g = map.get(o.seller_id) ?? {
        sellerId: o.seller_id,
        storeName: o.seller?.store_name ?? `Venditore ${o.seller_id.slice(0, 6)}`,
        iban: o.seller?.billing_iban ?? null,
        orders: [],
        dueCents: 0,
        paidCents: 0,
      };
      g.orders.push(o);
      const cents = o.seller_payout_cents ?? 0;
      const t = payoutTone(o);
      if (t.tone === 'paid' && o.payout_status === 'TRANSFERRED') g.paidCents += cents;
      else if (t.tone === 'ready' || t.tone === 'hold') g.dueCents += cents;
      map.set(o.seller_id, g);
    }
    // Ordina: prima chi ha più da liquidare.
    return Array.from(map.values()).sort((a, b) => b.dueCents - a.dueCents);
  }, [orders]);

  const totals = useMemo(() => {
    let due = 0;
    let hold = 0;
    let paid = 0;
    for (const o of orders) {
      const cents = o.seller_payout_cents ?? 0;
      const t = payoutTone(o);
      if (t.tone === 'ready') due += cents;
      else if (t.tone === 'hold') hold += cents;
      else if (o.payout_status === 'TRANSFERRED') paid += cents;
    }
    return { dueCents: due, holdCents: hold, paidCents: paid };
  }, [orders]);

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Trust & Safety"
        title="Payout venditori"
        sub="Riconciliazione dei bonifici ai negozi. Sola lettura: i pagamenti partono in automatico (carta ~1h dopo la consegna, COD dopo la conferma rimessa contanti)."
      />

      {/* KPI: pronto · in sospeso · già pagato */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <AdminStatCard icon={Banknote} tone="olive" label="Da pagare (pronto)" value={formatPrice(totals.dueCents / 100)} />
        <AdminStatCard icon={Clock} tone="accent" label="In sospeso" value={formatPrice(totals.holdCents / 100)} />
        <AdminStatCard icon={CheckCircle2} tone="primary" label="Già pagato" value={formatPrice(totals.paidCents / 100)} />
      </div>

      {/* Nota: pagamento automatico, niente azioni manuali */}
      <div className="flex items-start gap-2.5 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-ink-600">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-400" aria-hidden />
        <p>
          I bonifici sono gestiti dal cron <span className="font-mono text-xs">release-payouts</span> verso l&apos;IBAN
          Stripe del venditore. Da qui controlli lo stato; non ci sono azioni di pagamento manuali.
        </p>
      </div>

      {groups.length === 0 ? (
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
                    <p className="font-mono text-xs text-ink-400">{maskIban(g.iban) ?? 'IBAN non impostato'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-400">Da liquidare</p>
                  <p className="font-mono text-lg font-extrabold text-olive-700">{formatPrice(g.dueCents / 100)}</p>
                  {g.paidCents > 0 && (
                    <p className="text-xs text-ink-500">{formatPrice(g.paidCents / 100)} già pagati</p>
                  )}
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
                          <td className="px-5 py-3 text-xs text-ink-500">{fmtDate(o.payout_at ?? o.created_at)}</td>
                          <td className="px-5 py-3 text-xs text-ink-600">
                            {o.payment_method === 'cod' ? 'Contanti' : 'Carta'}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-bold text-ink-900">
                            {formatPrice((o.seller_payout_cents ?? 0) / 100)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={`${t.cls} inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold`}>
                              {t.label}
                            </span>
                            {o.stripe_transfer_id && (
                              <span className="mt-0.5 block font-mono text-[10px] text-ink-400">
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
