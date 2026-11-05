import type { SectionContext } from './SectionContext';

/**
 * 5/11/2026 — Media e numero delle recensioni del negozio, in un posto solo.
 *
 * Vengono da `store_review_stats` (il conto vero, lo stesso dell'elenco dei negozi). Solo se
 * quella lettura non c'è si ripiega sulle recensioni lette per l'elenco, che sono al massimo
 * le ultime 20. `null` = nessuna recensione.
 */
export function riepilogoRecensioni(
  ctx: Pick<SectionContext, 'reviews' | 'riepilogoRecensioni'>,
): { media: number; totale: number } | null {
  const vero = ctx.riepilogoRecensioni;
  if (vero && vero.totale > 0) return vero;
  if (ctx.reviews.length === 0) return null;
  const media = ctx.reviews.reduce((s, r) => s + Number(r.rating), 0) / ctx.reviews.length;
  return { media, totale: ctx.reviews.length };
}
