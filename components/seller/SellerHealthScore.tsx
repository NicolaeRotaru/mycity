'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

type Check = {
  id: string;
  label: string;
  points: number;
  passed: boolean;
  fix?: { href: string; label: string };
};

/**
 * Seller Health Score: punteggio 0-100 con suggerimenti azionabili.
 * Idea: il seller vuole sempre "salire di livello", come Strava o Duolingo.
 * Ogni check ha un peso e un fix-link diretto alla pagina dove correggere.
 */
export default function SellerHealthScore() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: checks = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.healthV2(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<Check[]> => {
      const { data: profile } = await supabase
        .from('profiles')
        .select(`
          store_name, store_description, store_logo, store_city,
          store_lat, store_lng, contact_phone, contact_email,
          billing_iban, business_pec, store_address
        `)
        .eq('id', userId!)
        .single();

      const { data: products } = await supabase
        .from('products')
        .select('id, name, description, images, price')
        .eq('seller_id', userId!);

      const totalProducts = products?.length ?? 0;
      const productsWithPhotos = (products ?? []).filter((p: any) => Array.isArray(p.images) && p.images.length > 0).length;
      const productsWithDescription = (products ?? []).filter((p: any) => p.description && p.description.length > 30).length;

      const out: Check[] = [
        {
          id: 'store-name',
          label: 'Nome del negozio impostato',
          points: 10,
          passed: !!profile?.store_name && profile.store_name.length > 2,
          fix: { href: '/seller/profile', label: 'Imposta nome' },
        },
        {
          id: 'store-logo',
          label: 'Logo del negozio caricato',
          points: 10,
          passed: !!profile?.store_logo,
          fix: { href: '/seller/profile', label: 'Carica logo' },
        },
        {
          id: 'store-desc',
          label: 'Descrizione del negozio compilata',
          points: 10,
          passed: !!profile?.store_description && profile.store_description.length > 50,
          fix: { href: '/seller/profile', label: 'Aggiungi descrizione' },
        },
        {
          id: 'store-address',
          label: 'Indirizzo fisico + GPS impostati',
          points: 15,
          passed: !!profile?.store_address && !!profile?.store_lat && !!profile?.store_lng,
          fix: { href: '/seller/profile', label: 'Imposta posizione' },
        },
        {
          id: 'contact-phone',
          label: 'Telefono di contatto',
          points: 5,
          passed: !!profile?.contact_phone,
          fix: { href: '/seller/profile', label: 'Aggiungi telefono' },
        },
        {
          id: 'billing-iban',
          label: 'IBAN per ricevere i pagamenti',
          points: 10,
          passed: !!profile?.billing_iban,
          fix: { href: '/seller/profile', label: 'Imposta IBAN' },
        },
        {
          id: 'min-3-products',
          label: 'Almeno 3 prodotti pubblicati',
          points: 15,
          passed: totalProducts >= 3,
          fix: { href: '/seller/products/new', label: 'Aggiungi prodotti' },
        },
        {
          id: 'photo-coverage',
          label: 'Tutti i prodotti hanno almeno una foto',
          points: 15,
          passed: totalProducts > 0 && productsWithPhotos === totalProducts,
          fix: { href: '/seller/products', label: 'Aggiungi foto' },
        },
        {
          id: 'desc-coverage',
          label: 'Tutti i prodotti hanno una descrizione',
          points: 10,
          passed: totalProducts > 0 && productsWithDescription === totalProducts,
          fix: { href: '/seller/products', label: 'Migliora descrizioni' },
        },
      ];

      return out;
    },
  });

  if (isLoading || !userId) {
    return <div className="h-64 rounded-2xl skeleton" aria-hidden />;
  }

  const totalPoints = checks.reduce((s, c) => s + c.points, 0);
  const earned = checks.filter((c) => c.passed).reduce((s, c) => s + c.points, 0);
  const score = totalPoints > 0 ? Math.round((earned / totalPoints) * 100) : 0;

  const tier =
    score >= 90 ? { label: 'Eccellente', color: 'olive', emoji: '🏆' } :
    score >= 70 ? { label: 'Ottimo',     color: 'primary', emoji: '⭐' } :
    score >= 40 ? { label: 'In crescita', color: 'accent', emoji: '🌱' } :
                  { label: 'Da migliorare', color: 'secondary', emoji: '🔧' };

  const todo = checks.filter((c) => !c.passed).slice(0, 3);

  return (
    <div className="bg-white border border-cream-300 rounded-2xl p-6 shadow-warm space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-500 font-semibold flex items-center gap-1.5">
            <Sparkles size={14} className="text-primary-600" />
            Health Score del negozio
          </p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-5xl font-serif font-extrabold text-ink-900">{score}</span>
            <span className="text-base text-ink-500">/ 100</span>
            <span className={`text-sm font-bold ${
              tier.color === 'olive' ? 'text-olive-700' :
              tier.color === 'primary' ? 'text-primary-700' :
              tier.color === 'accent' ? 'text-accent-700' :
              'text-secondary-700'
            }`}>
              {tier.emoji} {tier.label}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-cream-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            score >= 90 ? 'bg-olive-500' :
            score >= 70 ? 'bg-primary-600' :
            score >= 40 ? 'bg-accent-500' : 'bg-secondary-500'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* TODO actions */}
      {todo.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-ink-900 mb-2">
            <AlertCircle size={16} className="inline mr-1 text-accent-600" />
            Migliora subito ({todo.reduce((s, c) => s + c.points, 0)} punti in palio)
          </p>
          <ul className="space-y-2">
            {todo.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 bg-cream-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-primary-700 bg-primary-100 rounded-full px-2 py-0.5 shrink-0">
                    +{c.points}
                  </span>
                  <span className="text-sm text-ink-800 truncate">{c.label}</span>
                </div>
                {c.fix && (
                  <Link
                    href={c.fix.href}
                    className="text-xs font-semibold text-primary-700 hover:text-primary-800 shrink-0 inline-flex items-center gap-0.5 whitespace-nowrap"
                  >
                    {c.fix.label}
                    <ArrowRight size={12} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lista completa (collapsible) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-500 hover:text-ink-800 font-medium">
          Vedi tutti i controlli ({checks.filter((c) => c.passed).length}/{checks.length})
        </summary>
        <ul className="mt-3 space-y-1">
          {checks.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 px-2 py-1.5 rounded ${c.passed ? 'text-ink-700' : 'text-ink-500'}`}>
              {c.passed ? (
                <CheckCircle2 size={16} className="text-olive-600 shrink-0" />
              ) : (
                <span className="w-4 h-4 border-2 border-ink-300 rounded-full shrink-0" />
              )}
              <span className={`flex-1 ${c.passed ? 'line-through text-ink-400' : ''}`}>{c.label}</span>
              <span className="text-xs font-semibold text-ink-400">+{c.points}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
