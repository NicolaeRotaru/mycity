import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

export type CrumbItem = {
  /** Etichetta mostrata nel breadcrumb. */
  label: string;
  /** Destinazione (link). L'ultima voce (pagina corrente) va lasciata senza href. */
  href?: string;
};

interface CollectionHeaderProps {
  /** Occhiello in maiuscolo sopra il titolo (es. "Appena arrivati"). */
  eyebrow: string;
  /** Titolo serif H1 della pagina. */
  title: string;
  /** Riga di descrizione sotto il titolo. */
  blurb?: string;
  /** Icona lucide mostrata nel chip terracotta. */
  icon: LucideIcon;
  /**
   * Voci del breadcrumb. Per convenzione la prima è "Home" e l'ultima è la
   * pagina corrente (senza href). Se omesso, viene generato `Home › {title}`.
   */
  breadcrumb?: CrumbItem[];
  /**
   * Contenuto opzionale renderizzato sotto l'intestazione: tipicamente la barra
   * conteggio risultati + controllo di ordinamento già presente nella pagina.
   */
  children?: React.ReactNode;
}

/**
 * Intestazione condivisa delle pagine di scoperta / collezioni del buyer
 * (novita, piu-venduti, piccoli-prezzi, promozioni, regali, near, events, lists).
 *
 * Rende, allineato a sinistra e dentro il container del kit discovery:
 *  - breadcrumb accessibile (Home › Titolo)
 *  - chip icona terracotta 52px (bg primary-100 / icona primary-700)
 *  - occhiello in maiuscolo (primary-700)
 *  - H1 serif
 *  - blurb a una riga (ink-500)
 *
 * Tutto su token di brand: nessun colore decorativo fuori palette.
 */
export default function CollectionHeader({
  eyebrow,
  title,
  blurb,
  icon: Icon,
  breadcrumb,
  children,
}: CollectionHeaderProps) {
  const crumbs: CrumbItem[] = breadcrumb ?? [{ label: 'Home', href: '/' }, { label: title }];

  return (
    <header className="mb-5">
      <nav aria-label="Breadcrumb" className="mb-2.5">
        <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-500">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
                {c.href && !isLast ? (
                  <Link href={c.href} className="hover:text-ink-700 transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span className={isLast ? 'text-ink-700' : undefined} aria-current={isLast ? 'page' : undefined}>
                    {c.label}
                  </span>
                )}
                {!isLast && <ChevronRight size={13} className="text-ink-400 shrink-0" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-3.5">
        <span
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700"
          aria-hidden
        >
          <Icon size={26} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">{eyebrow}</p>
          <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
            {title}
          </h1>
          {blurb && <p className="mt-1 text-sm text-ink-500">{blurb}</p>}
        </div>
      </div>

      {children}
    </header>
  );
}
