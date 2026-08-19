import { Star, StarHalf } from 'lucide-react';

/**
 * RatingStars — unica fonte di verità per la visualizzazione delle stelle di rating.
 *
 * Prima coesistevano due sistemi: glifi unicode ★/☆ (in scheda prodotto, recensioni
 * negozio, ecc.) e icone Lucide (ReviewsSection). Questo componente unifica tutto su
 * Lucide: stelle piene/mezze/vuote, accessibile (role=img + aria-label), colore brand.
 *
 * NB: per le stelle INTERATTIVE (selettore voto nei form) restano i controlli dedicati;
 * questo componente è di sola visualizzazione.
 */
export function RatingStars({
  rating,
  size = 16,
  className = '',
}: {
  rating: number;
  size?: number;
  className?: string;
}) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  return (
    <span
      role="img"
      aria-label={`${rating.toFixed(1)} su 5 stelle`}
      className={`inline-flex items-center ${className}`}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        // 149 — accent-500 sulle stelle misurava 2,16:1 contro il fondo: sotto
        // qualunque soglia. Chi ha una vista debole vedeva cinque macchie
        // uguali. accent-700 (#9D621C) misura 5,00:1 e resta lo stesso giallo
        // caldo. Le stelle vuote passano da ink-300 a ink-400 per distinguersi.
        if (i < full) {
          return <Star key={i} size={size} className="fill-accent-700 text-accent-700" aria-hidden />;
        }
        if (i === full && hasHalf) {
          return <StarHalf key={i} size={size} className="fill-accent-700 text-accent-700" aria-hidden />;
        }
        return <Star key={i} size={size} strokeWidth={2.2} className="fill-none text-ink-400" aria-hidden />;
      })}
    </span>
  );
}

export default RatingStars;
