'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';
import { inModalitaDemo, TESTO_MODALITA_DEMO } from '@/lib/modalita-demo';

/**
 * «Sei in modalità demo» in cima alla dashboard (24/11/2026): il negozio approvato che non ha ancora
 * un abbonamento ai servizi non si vede sul marketplace. La risposta la dà il database
 * (negozio_in_vetrina, migrazione 709), la stessa regola che nasconde la vetrina al pubblico.
 */
export default function BannerModalitaDemo() {
  const { profile } = useProfile();
  const id = profile?.id ?? '';
  const approvato = profile?.is_approved === true;
  const { data: inVetrina } = useQuery({
    queryKey: ['seller', 'in-vetrina', id],
    enabled: approvato && !!id,
    queryFn: async (): Promise<boolean | null> => {
      const { data, error } = await supabase.rpc('negozio_in_vetrina', { p_id: id });
      if (error) return null;
      return data === true;
    },
  });
  if (!inModalitaDemo({ approvato, inVetrina })) return null;
  return (
    <section role="status" className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" data-testid="banner-modalita-demo">
      <p className="inline-flex items-center gap-2 font-semibold text-ink-900">
        <EyeOff size={18} className="text-amber-700" aria-hidden /> {TESTO_MODALITA_DEMO.titolo}
      </p>
      <p className="mt-1 text-sm text-ink-700">{TESTO_MODALITA_DEMO.testo}</p>
      <Link href={TESTO_MODALITA_DEMO.href} className="mt-3 inline-block rounded-lg bg-ink-900 px-4 py-2 text-sm font-bold text-white hover:bg-ink-800">
        {TESTO_MODALITA_DEMO.pulsante}
      </Link>
    </section>
  );
}
