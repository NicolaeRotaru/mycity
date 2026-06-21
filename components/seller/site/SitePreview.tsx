'use client';

import { useState, type CSSProperties } from 'react';
import {
  Monitor, Smartphone, MapPin, Clock, Megaphone, Star, Image as ImageIcon, Film,
  Phone, Tag, HelpCircle, type LucideIcon,
} from 'lucide-react';
import { enabledSections, type SitePage, type SiteSection, type ThemeKey } from '@/lib/store-site';

/**
 * Anteprima dal vivo della pagina vetrina (app/seller/site).
 *
 * Riproduce lo "stile" della pagina /store/[id] in forma LEGGERA: non monta i veri
 * componenti di store-sections/* (che richiedono dati live — prodotti, recensioni,
 * promo — e quindi un SectionContext completo), ma disegna scheletri fedeli al look
 * reale (copertina con gradient accent, griglie prodotto, card recensione, ecc.),
 * tinti con l'accent del negozio. Si aggiorna in tempo reale dalla bozza locale
 * dell'editor, così il venditore vede l'effetto di ordine/visibilità/testi mentre
 * compone. Design: design-system/ui_kits/seller/src/85-extra.txt → Vetrina/VetBlock.
 *
 * Importante: legge SOLO la bozza (sezioni + tema + accent). Non duplica lo schema
 * né tocca il salvataggio; resta un puro renderer di presentazione.
 */

type ViewKind = 'desktop' | 'mobile';

export default function SitePreview({
  page,
  theme,
  accent,
  storeName,
  storeSlug,
  selectedId,
}: {
  page: SitePage;
  theme: ThemeKey;
  accent: string;
  storeName: string;
  /** Slug/percorso mostrato nella barra del browser finta (solo estetica). */
  storeSlug: string;
  /** id della sezione attualmente in modifica: la evidenzia nell'anteprima. */
  selectedId?: string | null;
}) {
  const [view, setView] = useState<ViewKind>('desktop');
  const sections = enabledSections(page);
  const isMobile = view === 'mobile';

  return (
    <section
      data-theme={theme}
      className="overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm lg:sticky lg:top-4"
      aria-label="Anteprima della vetrina"
    >
      {/* Barra "browser" finta: pallini, URL, toggle desktop/mobile */}
      <div className="flex items-center gap-2 border-b border-cream-200 bg-cream-50 px-3.5 py-2.5">
        <span className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-secondary-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-accent-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-olive-400" />
        </span>
        <span className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-ink-400">
          mycity.it/negozio/{storeSlug}
        </span>
        <div className="inline-flex shrink-0 rounded-full border border-cream-300 bg-white p-0.5">
          {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([k, Icon]) => {
            const active = view === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                aria-label={k === 'desktop' ? 'Anteprima desktop' : 'Anteprima mobile'}
                aria-pressed={active}
                title={k === 'desktop' ? 'Anteprima desktop' : 'Anteprima mobile'}
                className={`inline-flex items-center rounded-full px-2.5 py-1.5 transition-colors ${
                  active ? 'bg-primary-700 text-white' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                <Icon size={14} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>

      {/* Tela dell'anteprima */}
      <div
        className={`max-h-[640px] overflow-y-auto ${isMobile ? 'flex justify-center bg-cream-200 py-5' : 'block bg-cream-50/40'}`}
      >
        <div
          className={
            isMobile
              ? 'w-[320px] max-w-full overflow-hidden rounded-[1.75rem] border-[5px] border-ink-900 bg-white shadow-warm-lg'
              : 'w-full bg-white'
          }
        >
          {sections.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-ink-400">
              Nessuna sezione attiva — aggiungine una per comporre la pagina.
            </div>
          ) : (
            sections.map((s) => (
              <PreviewBlock key={s.id} section={s} accent={accent} storeName={storeName} highlighted={s.id === selectedId} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Scheletro di una sezione, fedele al look reale e tinto con l'accent ── */

function PreviewBlock({
  section,
  accent,
  storeName,
  highlighted,
}: {
  section: SiteSection;
  accent: string;
  storeName: string;
  highlighted: boolean;
}) {
  return (
    <div className={`relative ${highlighted ? 'ring-2 ring-inset ring-primary-400' : ''}`}>
      <BlockBody section={section} accent={accent} storeName={storeName} />
    </div>
  );
}

const accentStyle = (accent: string): CSSProperties => ({ color: accent });

function Heading({ children, accent, icon: Icon }: { children: React.ReactNode; accent?: string; icon?: LucideIcon }) {
  return (
    <h3 className="mb-2.5 flex items-center gap-1.5 font-serif text-base font-bold text-ink-900">
      {Icon && accent && <Icon size={16} style={accentStyle(accent)} aria-hidden />}
      {children}
    </h3>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'MC';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function BlockBody({ section, accent, storeName }: { section: SiteSection; accent: string; storeName: string }) {
  switch (section.type) {
    case 'hero':
      return (
        <div>
          <div
            className="h-28 w-full"
            style={{ background: `linear-gradient(135deg, ${accent}, var(--accent-300))` }}
            aria-hidden
          />
          <div className="-mt-7 px-4 pb-4">
            <span
              className="inline-flex h-14 w-14 items-center justify-center rounded-xl border-[3px] border-white bg-white font-serif text-xl font-extrabold shadow-warm-sm"
              style={accentStyle(accent)}
            >
              {initialsOf(storeName)}
            </span>
            <h2 className="mt-2.5 font-serif text-xl font-extrabold text-ink-900">{storeName || 'Il tuo negozio'}</h2>
            {section.config.showDescription !== false && (
              <p className="text-sm leading-relaxed text-ink-500">La tua descrizione e il tuo slogan appaiono qui.</p>
            )}
            {section.config.showBadges !== false && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {['Produzione propria', 'Consegna rapida'].map((b) => (
                  <span key={b} className="rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-semibold text-ink-600">{b}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      );

    case 'banner': {
      const c = section.config;
      const overlay = c.overlay ?? 'dark';
      const isDark = overlay === 'dark';
      const isLight = overlay === 'light';
      return (
        <div className="px-4 py-3.5">
          <div
            className="flex flex-col justify-center rounded-xl px-4 py-5"
            style={
              isDark
                ? { background: accent, color: '#fff' }
                : isLight
                  ? { background: 'var(--cream-100)', color: 'var(--ink-900)' }
                  : { background: 'transparent', color: 'var(--ink-900)', border: '1px solid var(--cream-300)' }
            }
          >
            <span className="font-serif text-lg font-bold">{c.heading || 'Titolo del banner'}</span>
            {c.subheading && <span className="mt-1 text-sm opacity-90">{c.subheading}</span>}
            {c.cta?.label && (
              <span
                className="mt-3 inline-flex w-fit items-center rounded-lg px-3.5 py-1.5 text-sm font-semibold"
                style={isDark ? { background: '#fff', color: accent } : { background: accent, color: '#fff' }}
              >
                {c.cta.label}
              </span>
            )}
          </div>
        </div>
      );
    }

    case 'featured':
    case 'promotions':
    case 'productGrid':
    case 'collection': {
      const headingMap: Record<string, string> = {
        featured: 'In evidenza',
        promotions: 'Promozioni',
        productGrid: 'Tutti i prodotti',
        collection: 'Collezione',
      };
      const heading =
        (section.type === 'collection' && section.config.heading) || headingMap[section.type];
      const count = section.type === 'collection' && section.config.layout === 'carousel' ? 3 : 6;
      return (
        <div className="px-4 py-4">
          <Heading accent={accent} icon={section.type === 'promotions' ? Tag : undefined}>{heading}</Heading>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-cream-300 bg-white">
                <div className="aspect-square bg-cream-100" aria-hidden />
                <div className="space-y-1.5 p-1.5">
                  <div className="h-1.5 w-4/5 rounded bg-cream-300" aria-hidden />
                  <div className="h-1.5 w-2/5 rounded opacity-70" style={{ background: accent }} aria-hidden />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'gallery': {
      const c = section.config;
      const items = c.items ?? [];
      return (
        <div className="px-4 py-4">
          {c.heading && <Heading accent={accent} icon={ImageIcon}>{c.heading}</Heading>}
          <div className="grid grid-cols-3 gap-2">
            {(items.length > 0 ? items.slice(0, 6) : Array.from({ length: 3 }).map(() => null)).map((it, i) =>
              it ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={i} src={it.url} alt={it.alt ?? ''} className="aspect-square w-full rounded-lg border border-cream-200 object-cover" />
              ) : (
                <div key={i} className="flex aspect-square items-center justify-center rounded-lg border border-cream-300 bg-cream-100" aria-hidden>
                  <ImageIcon size={18} className="text-ink-300" aria-hidden />
                </div>
              ),
            )}
          </div>
        </div>
      );
    }

    case 'video': {
      const c = section.config;
      return (
        <div className="px-4 py-4">
          {c.heading && <Heading accent={accent} icon={Film}>{c.heading}</Heading>}
          <div className="flex aspect-video items-center justify-center rounded-xl bg-ink-900/90" aria-hidden>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/90">
              <Film size={18} style={accentStyle(accent)} aria-hidden />
            </span>
          </div>
        </div>
      );
    }

    case 'reviews':
      return (
        <div className="px-4 py-4">
          <Heading accent={accent} icon={Star}>Recensioni</Heading>
          <div className="rounded-lg border border-cream-300 bg-white p-3">
            <div className="flex gap-0.5" style={accentStyle(accent)} aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" aria-hidden />)}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">“Prodotti ottimi e consegna puntuale.”</p>
            <p className="mt-1.5 text-xs text-ink-400">— Una cliente</p>
          </div>
        </div>
      );

    case 'faq': {
      const c = section.config;
      const items = c.items ?? [];
      const shown = items.length > 0 ? items.slice(0, 3) : [{ q: 'Una domanda frequente', a: '' }];
      return (
        <div className="px-4 py-4">
          {c.heading && <Heading accent={accent} icon={HelpCircle}>{c.heading}</Heading>}
          <div className="space-y-2">
            {shown.map((it, i) => (
              <div key={i} className="rounded-lg border border-cream-200 px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
                  <HelpCircle size={13} style={accentStyle(accent)} aria-hidden /> {it.q || 'Domanda'}
                </p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'richText': {
      const c = section.config;
      return (
        <div className="px-4 py-4">
          {c.heading && <Heading>{c.heading}</Heading>}
          {c.body ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">{stripTags(c.body)}</p>
          ) : (
            <div className="space-y-1.5" aria-hidden>
              <div className="h-2 w-full rounded bg-cream-200" />
              <div className="h-2 w-11/12 rounded bg-cream-200" />
              <div className="h-2 w-3/5 rounded bg-cream-200" />
            </div>
          )}
        </div>
      );
    }

    case 'hours':
      return (
        <div className="px-4 py-4">
          <Heading accent={accent} icon={Clock}>Orari</Heading>
          <p className="text-sm leading-relaxed text-ink-600">Lun–Sab 8:00–19:30 · Domenica chiuso</p>
        </div>
      );

    case 'contact':
      return (
        <div className="px-4 py-4">
          <Heading accent={accent} icon={MapPin}>Dove siamo</Heading>
          <p className="flex items-center gap-1.5 text-sm text-ink-600">
            <Phone size={13} className="text-ink-400" aria-hidden /> Telefono e indirizzo del negozio
          </p>
          <div className="relative mt-2.5 h-20 overflow-hidden rounded-lg border border-cream-300 bg-gradient-to-br from-cream-200 to-cream-100" aria-hidden>
            <MapPin size={22} style={accentStyle(accent)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden />
          </div>
        </div>
      );

    default:
      return (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-ink-400">
          <Megaphone size={14} aria-hidden /> Sezione
        </div>
      );
  }
}

/** Rimuove i tag HTML per l'anteprima testuale leggera (il render reale li sanitizza). */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
