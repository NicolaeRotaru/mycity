'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { AdminPageTitle } from '@/components/admin/AdminUI';

/**
 * Rimesse contanti COD (🔴-1 slice 2/UI). Elenca i gruppi rider·giorno con ordini
 * COD consegnati in attesa di rimessa (payout_status='AWAITING_REMITTANCE'); l'admin
 * conferma i contanti ricevuti → confirm_cod_remittance rilascia quegli ordini a
 * 'HELD' e il cron release-payouts paga i venditori.
 */

type Row = {
  id: string;
  rider_id: string;
  delivered_at: string;
  total_price: string | number;
  shipping_cost: string | number | null;
  rider: { full_name: string | null } | null;
};

type Group = {
  riderId: string;
  riderName: string;
  date: string; // YYYY-MM-DD (UTC) — coerente con confirm_cod_remittance
  orders: number;
  toRemitCents: number; // Σ (totale − spedizione): il rider tiene la spedizione, rimette il resto
};

export default function AdminCodRemittancePage() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: queryKeys.admin.codRemittances,
    queryFn: async (): Promise<Row[]> => {
      const { data } = await supabase
        .from('orders')
        .select('id, rider_id, delivered_at, total_price, shipping_cost, rider:profiles!orders_rider_id_fkey(full_name)')
        .eq('payment_method', 'cod')
        .eq('delivery_status', 'DELIVERED')
        .eq('payout_status', 'AWAITING_REMITTANCE')
        .not('rider_id', 'is', null)
        .order('delivered_at', { ascending: false })
        .limit(1000);
      return (data ?? []) as unknown as Row[];
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const o of rows) {
      if (!o.delivered_at || !o.rider_id) continue;
      const date = new Date(o.delivered_at).toISOString().slice(0, 10);
      const key = `${o.rider_id}|${date}`;
      const cents = Math.round(Number(o.total_price) * 100) - Math.round(Number(o.shipping_cost ?? 0) * 100);
      const g = map.get(key) ?? {
        riderId: o.rider_id,
        riderName: o.rider?.full_name ?? o.rider_id.slice(0, 8),
        date,
        orders: 0,
        toRemitCents: 0,
      };
      g.orders += 1;
      g.toRemitCents += Math.max(0, cents);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rows]);

  const confirm = useMutation({
    mutationFn: async ({ riderId, date }: { riderId: string; date: string }): Promise<number> => {
      // Cookie-based (niente Bearer): l'RPC confirm_cod_remittance verifica
      // is_admin() leggendo l'auth.uid() dell'admin via getServerSupabase.
      const res = await fetch('/api/admin/cod-remittance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? 'Errore conferma rimessa');
      return (data.released as number) ?? 0;
    },
    onSuccess: (released) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.codRemittances });
      toast.success(`Rimessa confermata · ${released} ordini rilasciati al payout`);
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const totalToRemit = groups.reduce((s, g) => s + g.toRemitCents, 0);

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Finanza"
        title="Rimesse contanti COD"
        sub="Conferma i contanti ricevuti dai rider per sbloccare il pagamento ai venditori. L'importo da rimettere è il totale incassato meno il compenso di consegna del rider."
      />

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl skeleton" />)}</div>
      ) : groups.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-2xl p-12 text-center">
          <CheckCircle2 size={40} strokeWidth={2} className="mx-auto text-olive-500 mb-2" aria-hidden />
          <p className="text-ink-600 font-medium">Nessuna rimessa COD in attesa</p>
        </div>
      ) : (
        <>
          <div className="bg-cream-50 border border-cream-300 rounded-xl px-4 py-3 text-sm text-ink-700">
            In attesa: <strong>{groups.length}</strong> rider·giorno · totale da rimettere{' '}
            <strong>{formatPrice(totalToRemit / 100)}</strong>
          </div>
          <div className="space-y-3">
            {groups.map((g) => (
              <div
                key={`${g.riderId}|${g.date}`}
                className="bg-white border border-cream-300 rounded-2xl p-5 shadow-warm flex items-center justify-between gap-4 flex-wrap"
              >
                <div>
                  <p className="text-sm font-bold text-ink-900">{g.riderName}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {new Date(g.date).toLocaleDateString('it-IT')} · {g.orders} ordini COD
                  </p>
                  <p className="text-lg font-bold text-ink-900 mt-1">{formatPrice(g.toRemitCents / 100)}</p>
                </div>
                <Button
                  size="sm"
                  icon={Check}
                  loading={
                    confirm.isPending &&
                    confirm.variables?.riderId === g.riderId &&
                    confirm.variables?.date === g.date
                  }
                  onClick={() => confirm.mutate({ riderId: g.riderId, date: g.date })}
                >
                  Conferma rimessa
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
