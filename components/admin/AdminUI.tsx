import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * Primitive condivise del cockpit admin (design system v2, kit admin).
 * Server-safe (nessun hook): usabili in pagine server o client.
 */

type Tone = 'primary' | 'accent' | 'olive' | 'secondary';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  primary:   { bg: 'bg-primary-100',   fg: 'text-primary-700' },
  accent:    { bg: 'bg-accent-100',    fg: 'text-accent-700' },
  olive:     { bg: 'bg-olive-100',     fg: 'text-olive-700' },
  secondary: { bg: 'bg-secondary-100', fg: 'text-secondary-600' },
};

/** Titolo pagina admin: barra-accento + eyebrow + titolo serif + sottotitolo. */
export function AdminPageTitle({
  eyebrow, title, sub, action,
}: { eyebrow?: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-stretch gap-3.5">
        <span aria-hidden className="w-1 shrink-0 rounded-full bg-gradient-to-b from-primary-500 to-secondary-600" />
        <div>
          {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-primary-700">{eyebrow}</p>}
          <h1 className="font-serif text-3xl font-extrabold leading-tight tracking-tight text-ink-900">{title}</h1>
          {sub && <p className="mt-1 text-sm leading-normal text-ink-500">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Etichetta di sezione: icona + testo maiuscoletto. */
export function AdminSectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.03em] text-ink-800">
      <Icon size={15} strokeWidth={2.4} className="text-primary-700" aria-hidden />
      {children}
    </h2>
  );
}

/** Tile KPI: medaglione tinta + label + valore. Cliccabile se `href`. */
export function AdminStatCard({
  icon: Icon, tone, label, value, href,
}: { icon: LucideIcon; tone: Tone; label: string; value: string | number; href?: string }) {
  const t = TONE[tone];
  const inner = (
    <div className={`rounded-xl border-2 border-cream-300 bg-white p-4 transition-colors ${href ? 'hover:border-primary-400' : ''}`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-md ${t.bg} ${t.fg}`}>
          <Icon size={19} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.04em] text-ink-400">{label}</span>
      </div>
      <p className="text-[26px] font-extrabold leading-none text-ink-900">{value}</p>
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}
