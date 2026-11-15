'use client';

import Image from 'next/image';
import Link from 'next/link';
import { sizedImage } from '@/lib/image-url';
import caricatoreFotoRemote from '@/lib/image-loader';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { ctaHref } from '@/lib/store-site';
import type { SectionConfig, SectionContext } from './SectionContext';

/** Banner: immagine grande con titolo, sottotitolo e pulsante CTA (link interno/esterno). */
export default function BannerSection({ config, ctx }: { config: SectionConfig<'banner'>; ctx: SectionContext }) {
  // 12/11/2026 (R07-023) — Il pulsante può puntare a un prodotto scelto quando era in vendita
  // e poi messo in bozza: il cliente arrivava su una scheda che non si apre. Si chiede al
  // database se il prodotto è ancora in vetrina (`prodotto_in_vetrina`, migrazione 129, aperta
  // ad anon): il pulsante verso un prodotto compare solo quando la risposta è sì. Finché la
  // risposta non c'è (anche nell'HTML del server, letto da Google e da chi non ha JavaScript)
  // il pulsante non si disegna; se la domanda cade, si lascia com'era prima.
  // (Il precarico della vetrina non lo porta: lib/queries/precarico.ts legge solo il negozio.)
  const prodottoDelPulsante = config.cta?.target.kind === 'product' ? config.cta.target.productId || null : null;
  const inVetrina = useQuery({
    queryKey: ['prodotto-in-vetrina', prodottoDelPulsante],
    enabled: !!prodottoDelPulsante,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc('prodotto_in_vetrina', { p_id: prodottoDelPulsante });
      if (error) throw error;
      return data === true;
    },
  });
  const prodottoFuoriVetrina = !!prodottoDelPulsante && inVetrina.data !== true && !inVetrina.isError;

  if (!config.imageUrl) return null;

  const overlay = config.overlay ?? 'dark';
  // Come la home e le pagine CMS: con il velo «nessuno» resta una sfumatura minima dal basso,
  // altrimenti la scritta bianca sulla foto chiara non si legge.
  const overlayClass = overlay === 'dark' ? 'bg-black/40' : overlay === 'light' ? 'bg-white/30' : 'bg-gradient-to-t from-black/45 via-black/10 to-transparent';
  const textClass = overlay === 'light' ? 'text-ink-900' : 'text-white';

  const href = config.cta ? ctaHref(config.cta.target, ctx.storeId, ctx.site) : null;
  const external = config.cta?.target.kind === 'external';
  const ctaClass = 'inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold shadow-warm transition-transform hover:-translate-y-0.5';
  const ctaStyle = { backgroundColor: ctx.accent, color: '#fff' };

  return (
    <section className="relative w-full h-56 sm:h-72 overflow-hidden rounded-2xl border border-cream-300 shadow-warm">
      <Image
        src={sizedImage(config.imageUrl, 'hero')}
        alt={config.alt ?? ''}
        fill
        sizes="(max-width: 768px) 100vw, 1024px"
        loader={caricatoreFotoRemote}
        className="object-cover"
      />
      {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} aria-hidden />}
      <div className={`absolute inset-0 flex flex-col items-start justify-end gap-2 p-6 ${textClass}`}>
        {config.heading && <h2 className="text-2xl sm:text-3xl font-bold font-serif drop-shadow">{config.heading}</h2>}
        {config.subheading && <p className="text-sm sm:text-base max-w-xl drop-shadow">{config.subheading}</p>}
        {config.cta && href && !prodottoFuoriVetrina && (
          external ? (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={ctaClass} style={ctaStyle}>
              {config.cta.label}
            </a>
          ) : (
            <Link href={href} className={ctaClass} style={ctaStyle}>
              {config.cta.label}
            </Link>
          )
        )}
      </div>
    </section>
  );
}
