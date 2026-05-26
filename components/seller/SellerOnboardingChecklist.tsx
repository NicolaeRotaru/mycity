'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle, ArrowRight, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';

/**
 * Checklist onboarding seller — guida visuale ai primi step concreti.
 *
 * Esperti consultati:
 * - Operations Manager: "Senza checklist seller non sa cosa fare dopo signup.
 *   Glovo onboarding ha 7 step espliciti."
 * - UX Designer: "Progress bar visiva + check completati danno dopamina.
 *   Behavioural reward per completare."
 * - Senior PM: "Si nasconde quando 100% completato. Niente clutter eterno."
 *
 * Step:
 *  1. Nome negozio impostato
 *  2. Logo caricato
 *  3. Indirizzo + GPS
 *  4. Orari apertura
 *  5. Almeno 3 prodotti pubblicati
 *  6. Account Stripe Connect attivato (per ricevere payout)
 */

type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  href: string;
};

export default function SellerOnboardingChecklist() {
  const { profile } = useProfile();

  const { data: items = [] } = useQuery({
    queryKey: ['seller-onboarding-checklist', profile?.id],
    enabled: !!profile?.id,
    queryFn: async (): Promise<ChecklistItem[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: p } = await supabase
        .from('profiles')
        .select(`
          store_name, store_logo, store_address, store_lat, store_lng,
          store_hours, stripe_charges_enabled
        `)
        .eq('id', user.id)
        .single();

      const { count: productCount } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .eq('status', 'available');

      return [
        {
          id: 'name',
          label: 'Imposta nome e descrizione',
          done: !!p?.store_name && p.store_name.length > 2,
          href: '/seller/profile',
        },
        {
          id: 'logo',
          label: 'Carica logo del negozio',
          done: !!p?.store_logo,
          href: '/seller/profile',
        },
        {
          id: 'address',
          label: 'Indirizzo + posizione mappa',
          done: !!p?.store_address && !!p?.store_lat && !!p?.store_lng,
          href: '/seller/profile',
        },
        {
          id: 'hours',
          label: 'Orari di apertura',
          done: !!p?.store_hours && Object.keys(p.store_hours).length > 0,
          href: '/seller/profile',
        },
        {
          id: 'products',
          label: 'Pubblica almeno 3 prodotti',
          done: (productCount ?? 0) >= 3,
          href: '/seller/products/new',
        },
        {
          id: 'payouts',
          label: 'Attiva pagamenti (Stripe Connect)',
          done: !!p?.stripe_charges_enabled,
          href: '/seller/earnings',
        },
      ];
    },
  });

  if (items.length === 0) return null;
  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = (completed / total) * 100;
  if (completed === total) return null; // hide when 100%

  // Trova il primo non completato per CTA principale
  const nextStep = items.find((i) => !i.done);

  return (
    <div className="bg-gradient-to-br from-primary-50 to-cream-100 border-2 border-primary-200 rounded-2xl p-5 sm:p-6 shadow-warm mb-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-primary-700 text-white flex items-center justify-center flex-shrink-0">
          <Sparkles size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-xl font-bold text-ink-900">
            Completa il tuo negozio
          </h2>
          <p className="text-sm text-ink-600">
            Mancano {total - completed} passi. Negozi completi vendono <strong>3x di più</strong>.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-2xl font-bold text-primary-700">{completed}/{total}</p>
          <p className="text-xs text-ink-500">completati</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-white rounded-full overflow-hidden mb-4">
        <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Lista step */}
      <ul className="space-y-2 mb-4">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                item.done ? 'opacity-60' : 'hover:bg-white'
              }`}
            >
              {item.done ? (
                <Check size={18} className="text-olive-700 flex-shrink-0" strokeWidth={2.4} />
              ) : (
                <Circle size={18} className="text-ink-400 flex-shrink-0" strokeWidth={2.4} />
              )}
              <span className={`flex-1 text-sm font-medium ${item.done ? 'text-ink-500 line-through' : 'text-ink-900'}`}>
                {item.label}
              </span>
              {!item.done && <ArrowRight size={14} className="text-primary-700" strokeWidth={2.4} />}
            </Link>
          </li>
        ))}
      </ul>

      {nextStep && (
        <Link
          href={nextStep.href}
          className="inline-flex items-center gap-2 bg-primary-700 hover:bg-primary-800 text-white px-5 py-2.5 rounded-full font-bold text-sm"
        >
          Continua: {nextStep.label} <ArrowRight size={14} strokeWidth={2.4} />
        </Link>
      )}
    </div>
  );
}
