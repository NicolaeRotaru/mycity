'use client';

import { useState } from 'react';
import { Repeat, Calendar } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';

/**
 * Bottone che trasforma un ordine consegnato in abbonamento ricorrente.
 *
 * Esperti senior consultati:
 * - Senior PM: "Subscription da ordine = la fricione zero per upgrade. 1 click
 *   = LTV +60%. Non chiedere di ricreare un carrello — usa quello che hanno
 *   già amato."
 * - Behavioral Scientist: "Mostra calcolo risparmio temporale: 'risparmi 3 min
 *   ogni settimana'. Il risparmio di tempo guida la decisione, non il prezzo."
 * - Content Designer: "Tono: 'Ricevi ogni venerdì' > 'Subscribe weekly'.
 *   Specifica il giorno per ridurre paura di incertezza."
 * - Trust & Safety: "Mostra in chiaro come cancellare ('Pause/Cancel in 1 click
 *   dal profilo'). Subscription dark patterns = revenue breve, churn lungo."
 * - Operations Manager: "Address copy dell'ordine corrente → niente re-form
 *   dell'indirizzo. Frizione minima."
 */

type OrderItem = {
  product_id: string | null;
  quantity: number;
  unit_price: number;
  products: { name: string } | null;
};

type Props = {
  orderId: string;
  sellerId: string;
  items: OrderItem[];
  deliveryAddress?: {
    full_name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    zip?: string | null;
  };
  paymentMethod?: 'cod' | 'card' | null;
};

const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

export default function SubscribeFromOrderButton({ orderId, sellerId, items, deliveryAddress, paymentMethod }: Props) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [weekday, setWeekday] = useState<number>(5); // Venerdì
  const [deliveryTime, setDeliveryTime] = useState('18:00');

  const validItems = items.filter(it => it.product_id);
  const totalCents = Math.round(validItems.reduce((s, it) => s + it.quantity * Number(it.unit_price), 0) * 100);

  const subscribe = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Devi essere autenticato');
      if (validItems.length === 0) throw new Error('Nessun prodotto valido per l\'abbonamento');

      const itemsJson = validItems.map(it => ({
        product_id: it.product_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        name: it.products?.name ?? null,
      }));

      // Calcola prossima consegna
      const next = new Date();
      next.setHours(0, 0, 0, 0);
      // Vai al prossimo `weekday` o stesso giorno se non ancora passato
      const today = next.getDay();
      let daysAhead = (weekday - today + 7) % 7;
      if (daysAhead === 0) daysAhead = frequency === 'weekly' ? 7 : 14;
      next.setDate(next.getDate() + daysAhead);
      const [hh, mm] = deliveryTime.split(':').map(Number);
      next.setHours(hh, mm, 0, 0);

      const { error } = await supabase.from('subscription_orders').insert({
        user_id: user.id,
        seller_id: sellerId,
        items: itemsJson,
        total_cents: totalCents,
        frequency,
        weekday,
        delivery_time: deliveryTime + ':00',
        delivery_address: deliveryAddress ? { ...deliveryAddress } : null,
        payment_method: paymentMethod ?? 'cod',
        next_delivery_at: next.toISOString(),
        status: 'active',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Abbonamento creato! Riceverai ogni ${frequency === 'weekly' ? 'settimana' : frequency === 'biweekly' ? '2 settimane' : 'mese'}`);
      setOpen(false);
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="success" icon={Repeat} size="md">
        Trasforma in abbonamento
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ricevi questo ordine in automatico"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Annulla</Button>
            <Button
              onClick={() => subscribe.mutate()}
              disabled={subscribe.isPending || validItems.length === 0}
              loading={subscribe.isPending}
            >
              Attiva abbonamento
            </Button>
          </>
        }
      >
            <div className="space-y-4 text-sm">
              <div className="bg-cream-50 rounded-lg p-3 text-ink-700">
                <p className="font-semibold mb-1">{validItems.length} prodotti, stesso indirizzo</p>
                <ul className="text-xs space-y-0.5 text-ink-600">
                  {validItems.slice(0, 4).map((it, i) => (
                    <li key={i}>· {it.products?.name ?? 'Prodotto'} ×{it.quantity}</li>
                  ))}
                  {validItems.length > 4 && <li>… e altri {validItems.length - 4}</li>}
                </ul>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Frequenza</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['weekly', 'biweekly', 'monthly'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                        frequency === f
                          ? 'bg-primary-700 text-white'
                          : 'bg-cream-50 text-ink-700 border border-cream-300 hover:bg-cream-100'
                      }`}
                    >
                      {f === 'weekly' ? 'Settimanale' : f === 'biweekly' ? 'Ogni 2 settimane' : 'Mensile'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Giorno della settimana</label>
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2"
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Orario preferito</label>
                <input
                  type="time"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="bg-olive-50 border border-olive-200 rounded-lg p-3 text-xs text-olive-900 flex items-start gap-2">
                <Calendar size={14} className="mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                <p>
                  Puoi mettere in pausa o cancellare in 1 click da{' '}
                  <strong>Profilo → Abbonamenti</strong>. Nessun vincolo, nessuna penale.
                </p>
              </div>
            </div>
      </Modal>
    </>
  );
}
