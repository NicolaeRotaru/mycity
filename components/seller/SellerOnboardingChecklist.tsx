'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle, ArrowRight, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';
import { Button } from '@/components/ui/Button';
import { queryKeys } from '@/lib/queries/keys';

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

  const { data: items, isError, refetch } = useQuery({
    queryKey: queryKeys.seller.onboardingChecklist(profile?.id ?? ''),
    enabled: !!profile?.id,
    queryFn: async (): Promise<ChecklistItem[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: p, error: erroreProfilo } = await supabase
        .from('profiles')
        .select(`
          store_name, store_logo, store_address, store_lat, store_lng,
          store_hours, stripe_charges_enabled
        `)
        .eq('id', user.id)
        .single();
      // Ogni «done» qui sotto si calcola da `p`. Con l'errore ingoiato `p` resta undefined, tutte e
      // sei le spunte diventano false, e la bacheca dice a un negozio finito che non ha fatto
      // niente — compreso «Attiva pagamenti» a chi li ha già attivi. È la prima schermata che il
      // negoziante apre, ed è la sola che gli dice cosa gli manca.
      if (erroreProfilo) throw erroreProfilo;

      const { count: productCount, error: erroreProdotti } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .eq('status', 'available');
      // `(undefined ?? 0) >= 3` è false: senza questa riga un negozio con quaranta prodotti si
      // sente dire «pubblica almeno 3 prodotti».
      if (erroreProdotti) throw erroreProdotti;

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

  // Tre esiti, non due. «Non ho letto» non è «non hai fatto niente»: sparire in silenzio
  // sarebbe comunque una bugia per un negozio a metà, quindi lo scrive e offre di riprovare.
  if (isError) {
    return (
      <div className="mb-6 rounded-2xl border-2 border-cream-300 bg-surface-0 p-5 sm:p-6">
        <h2 className="font-serif text-xl font-bold text-ink-900">Non ho potuto leggere lo stato del tuo negozio</h2>
        <p className="mt-1 text-sm text-ink-600">
          Non vuol dire che manchi qualcosa: vuol dire che la lettura non è riuscita.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white hover:bg-primary-800"
        >
          Riprova
        </button>
      </div>
    );
  }
  if (!items || items.length === 0) return null;   // ancora in lettura, o niente da mostrare
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
        <Button href={nextStep.href} size="sm" shape="pill" iconRight={ArrowRight}>
          Continua: {nextStep.label}
        </Button>
      )}
    </div>
  );
}
