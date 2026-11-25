import { Bell, Package, Tag, Gift, Sparkles, MessageCircle, type LucideIcon } from 'lucide-react';

/**
 * L'aspetto di una notifica (icona, colori, quando è arrivata): lo stesso nel Centro notifiche
 * e nella tendina della campanella del negozio. Prima stava solo dentro la pagina delle notifiche.
 */
export type NotificaDaMostrare = {
  title: string;
  body: string | null;
  link: string | null;
};

/**
 * Tono icona-badge per tipo di notifica. Solo brand token (primary/secondary/
 * accent/olive) — nessun colore decorativo fuori palette. Il tipo è derivato
 * da link + titolo, dato che lo schema non ha una colonna `type` dedicata.
 */
export type Tone = { bg: string; fg: string; icon: LucideIcon };
const TONES: Record<string, Tone> = {
  order:    { bg: 'bg-primary-100',   fg: 'text-primary-700',   icon: Package },
  promo:    { bg: 'bg-secondary-100', fg: 'text-secondary-700', icon: Tag },
  gift:     { bg: 'bg-accent-100',    fg: 'text-accent-700',    icon: Gift },
  loyalty:  { bg: 'bg-olive-100',     fg: 'text-olive-700',     icon: Sparkles },
  message:  { bg: 'bg-primary-100',   fg: 'text-primary-700',   icon: MessageCircle },
  default:  { bg: 'bg-cream-200',     fg: 'text-ink-600',       icon: Bell },
};

export function toneFor(n: NotificaDaMostrare): Tone {
  const hay = `${n.link ?? ''} ${n.title} ${n.body ?? ''}`.toLowerCase();
  if (/order|ordin|consegn|spedi|delivery|rider/.test(hay)) return TONES.order;
  if (/promo|sconto|offert|saldo|deal|drop/.test(hay)) return TONES.promo;
  if (/gift|regalo|buono|gift.?card/.test(hay)) return TONES.gift;
  if (/punt|loyalty|livello|tier|premio|cashback|referral|invit/.test(hay)) return TONES.loyalty;
  if (/messagg|chat|risposta/.test(hay)) return TONES.message;
  return TONES.default;
}

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'adesso';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min fa`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};
