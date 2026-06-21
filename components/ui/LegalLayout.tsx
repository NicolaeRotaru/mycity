import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Layout condiviso delle pagine legali — trattamento "legal.html" del design system:
 * H1 serif, callout "In breve", indice (table of contents) con ancore di sezione.
 *
 * Il contenuto legale vero e proprio (sezioni con testo) viene passato come children:
 * questo componente NON tocca la copia legale, restruttura solo la presentazione.
 */

export type TocItem = { id: string; label: string };

/** Documenti legali fratelli — la tab bar li collega tutti dalla cima di ognuno. */
const LEGAL_DOCS: { href: string; label: string }[] = [
  { href: '/terms', label: 'Termini' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/cookies', label: 'Cookie' },
  { href: '/accessibility', label: 'Accessibilità' },
];

type Props = {
  title: string;
  /** Route del documento corrente (es. "/privacy") → evidenzia la tab attiva. */
  active?: string;
  /** Riga meta sotto al titolo (versione / data / riferimenti normativi). */
  meta?: ReactNode;
  /** Riepilogo "In breve" — sintesi non vincolante in cima alla pagina. */
  summary: ReactNode;
  /** Voci dell'indice; ogni `id` deve corrispondere all'`id` di una sezione nei children. */
  toc: TocItem[];
  children: ReactNode;
};

export function LegalLayout({ title, active, meta, summary, toc, children }: Props) {
  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <div className="mb-2">
        <Link href="/" className="text-sm text-primary-700 hover:underline">← Home</Link>
      </div>
      <h1 className="font-serif text-3xl md:text-5xl font-extrabold text-ink-900 mb-2">{title}</h1>
      {meta && <p className="text-sm text-ink-500 mb-6">{meta}</p>}

      {/* Tab bar documenti legali fratelli — attiva = underline primary-600. */}
      <nav aria-label="Documenti legali" className="flex flex-wrap gap-1 border-b border-cream-300 mb-8 -mt-2">
        {LEGAL_DOCS.map((doc) => {
          const isActive = doc.href === active;
          return (
            <Link
              key={doc.href}
              href={doc.href}
              aria-current={isActive ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-ink-500 hover:text-ink-800'
              }`}
            >
              {doc.label}
            </Link>
          );
        })}
      </nav>

      {/* Callout "In breve" */}
      <div className="bg-cream-50 border border-cream-300 border-l-[3px] border-l-primary-500 rounded-r-md px-4 py-3.5 mb-8 text-sm leading-relaxed text-ink-700">
        <strong className="text-ink-900">In breve:</strong> {summary}
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_220px] lg:gap-8 lg:items-start">
        <div className="prose prose-gray max-w-none space-y-6 text-ink-700 leading-relaxed order-1">
          {children}
        </div>

        {/* Indice / TOC */}
        <nav
          aria-label="Indice della pagina"
          className="order-2 mt-8 lg:mt-0 lg:sticky lg:top-24 bg-white border border-cream-300 rounded-lg p-4 text-[13px]"
        >
          <p className="text-2xs font-bold uppercase tracking-label text-ink-900 mb-2">
            In questa pagina
          </p>
          <ul>
            {toc.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block py-1 text-ink-600 hover:text-primary-700"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

/**
 * Sezione legale con ancora: heading serif coerente + scroll-margin per l'offset
 * della navbar sticky. Mantiene il testo legale invariato (children).
 */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-bold text-ink-900 mb-2">{heading}</h2>
      {children}
    </section>
  );
}
