'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { Button } from '@/components/ui/Button';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { scrivi } from '@/lib/esito-scrittura';
import { vistaDeiCoupon, type Coupon, type CouponTipo } from '@/lib/admin/vista-dei-coupon';

/**
 * 8/9/2026 — QUESTA PAGINA RACCONTAVA ESITI CHE NON ERANO SUCCESSI, IN DUE PUNTI.
 *
 * ① Le scritture. `await supabase.from('coupons').delete().eq('id', id)` senza guardare la
 *    risposta: la funzione non poteva fallire, quindi partiva sempre il verde «Coupon eliminato»
 *    mentre il codice restava spendibile dai clienti. Adesso ogni scrittura passa da `scrivi`, che
 *    chiede indietro le righe toccate e LANCIA se non sono cambiate — vedi `lib/esito-scrittura.ts`.
 * ② La lettura. `const { data: coupons = [], isLoading }` trasformava una lettura caduta in un
 *    elenco vuoto, e il titolo scriveva «0 codici sconto». Adesso il ripiego non c'è più e lo
 *    stato lo decide `vistaDeiCoupon` — vedi `lib/admin/vista-dei-coupon.ts`.
 *
 * La regola che tiene insieme le due: **il pannello non afferma niente che non abbia verificato.**
 */

const empty: {
  code: string;
  type: CouponTipo;
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  first_order_only: boolean;
  description: string;
  active: boolean;
} = {
  code: '', type: 'PERCENT', value: 10, min_subtotal: 0,
  max_uses: null, first_order_only: false,
  description: '', active: true,
};

export default function AdminCouponsPage() {
  const qc = useQueryClient();
  const tConfirm = useTranslations('confirm');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);

  // Niente `= []`: un ripiego qui vuol dire spacciare «non ho letto» per «non c'è niente».
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.admin.coupons,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Coupon[];
    },
  });

  const vista = vistaDeiCoupon({ data, isPending, isError, error });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.toUpperCase().trim(),
        type: form.type,
        value: form.type === 'FREE_SHIPPING' ? 0 : Number(form.value),
        min_subtotal: Number(form.min_subtotal),
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        first_order_only: form.first_order_only,
        description: form.description.trim() || null,
        active: form.active,
      };
      return scrivi(
        () => supabase.from('coupons').insert(payload).select('id'),
        { cosa: 'Il coupon' },
      );
    },
    onSuccess: () => {
      setShowForm(false);
      setForm(empty);
      toast.success('Coupon creato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
    // L'elenco si ricarica comunque: dopo un tentativo andato male la verità sta nel database,
    // non in quello che ha in mano il browser.
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.coupons }),
  });

  const toggle = useMutation({
    mutationFn: (c: Coupon) => scrivi(
      () => supabase.from('coupons').update({ active: !c.active }).eq('id', c.id).select('id'),
      { cosa: `Il coupon ${c.code}` },
    ),
    onSuccess: (_esito, c) => toast.success(c.active ? `${c.code} disattivato` : `${c.code} attivato`),
    onError: (err: unknown) => toast.error(friendlyError(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.coupons }),
  });

  const remove = useMutation({
    mutationFn: (c: Coupon) => scrivi(
      () => supabase.from('coupons').delete().eq('id', c.id).select('id'),
      { cosa: `Il coupon ${c.code}` },
    ),
    onSuccess: (_esito, c) => toast.success(`Coupon ${c.code} eliminato`),
    onError: (err: unknown) => toast.error(friendlyError(err)),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.admin.coupons }),
  });

  if (vista.mostraScheletro) return <LoadingState />;

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Marketing"
        title="Coupon"
        sub={vista.sottotitolo}
        action={vista.permettiCreazione && !showForm && (
          <Button onClick={() => setShowForm(true)} icon={Plus}>Nuovo coupon</Button>
        )}
      />

      {/*
        La lettura è caduta: si ammette, non si disegna una tabella vuota. E il pulsante «Nuovo
        coupon» resta spento — chi crede che i codici siano spariti ne rifà uno uguale.
      */}
      {vista.avviso && (
        <ErrorState
          title={vista.avviso.titolo}
          description={vista.avviso.dettaglio}
          retry={() => { void refetch(); }}
          supportHref={null}
        />
      )}

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          className="bg-white border rounded-xl p-5 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Codice"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="ESTATE25"
              className="uppercase"
              required
            />
            <Select
              label="Tipo"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CouponTipo })}
            >
              <option value="PERCENT">Percentuale (%)</option>
              <option value="FIXED">Sconto fisso (€)</option>
              <option value="FREE_SHIPPING">Spedizione gratuita</option>
            </Select>
            {form.type !== 'FREE_SHIPPING' && (
              <Input
                label="Valore"
                type="number"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
                min={0}
                step={form.type === 'PERCENT' ? 1 : 0.5}
              />
            )}
            <Input
              label="Spesa minima (€)"
              type="number"
              value={form.min_subtotal}
              onChange={(e) => setForm({ ...form, min_subtotal: Number(e.target.value) })}
              min={0}
            />
            <Input
              label="Usi max (vuoto = illimitato)"
              type="number"
              value={form.max_uses ?? ''}
              onChange={(e) => setForm({ ...form, max_uses: e.target.value ? Number(e.target.value) : null })}
              min={1}
            />
            <Input
              label="Descrizione (opzionale)"
              containerClassName="sm:col-span-2"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <Checkbox
            label="Valido solo al primo ordine"
            checked={form.first_order_only}
            onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={create.isPending}>
              {create.isPending ? 'Creazione…' : 'Crea coupon'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Annulla
            </Button>
          </div>
        </form>
      )}

      {!vista.mostraErrore && (
      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Codice</th>
              <th className="p-3 text-left">Tipo</th>
              <th className="p-3 text-right">Valore</th>
              <th className="p-3 text-right">Spesa min</th>
              <th className="p-3 text-right">Usi</th>
              <th className="p-3 text-left">Stato</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {vista.mostraVuoto && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-ink-500">
                  Nessun codice sconto: ho guardato e non ce n’è ancora nessuno.
                </td>
              </tr>
            )}
            {vista.coupons.map((c) => (
              <tr key={c.id} className="border-t hover:bg-cream-50">
                <td className="p-3 font-mono font-bold text-ink-900">{c.code}</td>
                <td className="p-3 text-ink-700">
                  {c.type === 'PERCENT' ? 'Sconto %' : c.type === 'FIXED' ? 'Sconto €' : 'Spedizione gratis'}
                  {c.first_order_only && <span className="ml-2 text-xs bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded">1° ordine</span>}
                </td>
                <td className="p-3 text-right font-semibold">
                  {c.type === 'PERCENT' ? `${c.value}%` : c.type === 'FIXED' ? formatPrice(c.value) : '—'}
                </td>
                <td className="p-3 text-right text-ink-600">{formatPrice(c.min_subtotal)}</td>
                <td className="p-3 text-right text-ink-600">
                  {c.uses_count}{c.max_uses ? ` / ${c.max_uses}` : ''}
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggle.mutate(c)}
                    disabled={toggle.isPending}
                    aria-label={c.active ? `Disattiva il coupon ${c.code}` : `Attiva il coupon ${c.code}`}
                    className={`text-xs px-2 py-1 rounded font-semibold disabled:opacity-60 ${
                      c.active ? 'bg-olive-100 text-olive-700' : 'bg-cream-100 text-ink-500'
                    }`}
                  >
                    {c.active ? 'Attivo' : 'Disattivato'}
                  </button>
                </td>
                <td className="p-3">
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Eliminare il coupon?',
                        message: `Il codice ${c.code} non sarà più utilizzabile dai clienti.`,
                        confirmLabel: tConfirm('yesDelete'),
                        danger: true,
                        icon: Ticket,
                      });
                      if (ok) remove.mutate(c);
                    }}
                    disabled={remove.isPending}
                    className="text-xs text-secondary-600 hover:underline disabled:opacity-60"
                  >
                    Elimina
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
