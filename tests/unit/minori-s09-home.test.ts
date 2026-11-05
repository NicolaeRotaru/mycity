/**
 * S09 — La home (schede 2269, 2271, 1032, 845 e seguenti).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { riapreOggiAlle, scrittaApertura } from '@/components/home/orari-di-oggi';

const leggi = (p: string) => readFileSync(p, 'utf8');
const alle = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 10, 5);
  d.setHours(h, m, 0, 0);
  return d;
};
const FORNO: [string, string][] = [['08:00', '13:00'], ['16:00', '19:00']];

describe('2269 — «Chiuso» accanto a «Consegna oggi» dice quando riapre', () => {
  it('alle 14 il forno aperto 8-13 e 16-19 «riapre alle 16:00»', () => {
    expect(riapreOggiAlle(FORNO, alle('14:00'))).toBe('16:00');
    expect(scrittaApertura(false, FORNO, alle('14:00'))).toBe('Chiuso · riapre alle 16:00');
  });
  it('dopo l\'ultima chiusura è solo «Chiuso»', () => {
    expect(scrittaApertura(false, FORNO, alle('20:00'))).toBe('Chiuso');
  });
  it('aperto è «Aperto ora»', () => {
    expect(scrittaApertura(true, FORNO, alle('9:00'))).toBe('Aperto ora');
  });
  it('la scheda della home e la riga dell\'elenco usano questa scritta', () => {
    expect(leggi('components/home/HeroStoreCard.tsx')).toContain('scrittaApertura(openNow,');
    expect(leggi('components/StoreListRow.tsx')).toContain("scrittaChiusoDaOrari(hours)");
  });
});

describe('la scheda del negozio in evidenza (components/home/HeroStoreCard.tsx)', () => {
  const src = leggi('components/home/HeroStoreCard.tsx');
  it('2271 — il commento non dice più che «Consegna oggi» vale solo se aperto adesso', () => {
    expect(src).not.toMatch(/configurati per oggi ed è aperto adesso/);
  });
  it('1032 — la copertina, la foto più grande sopra la piega, non è pigra', () => {
    expect(src).toMatch(/<Image src=\{sizedImage\(cover, 'hero'\)\} alt="" fill sizes="384px" priority/);
  });
});

describe('845 — il prezzo grande del «Drop del giorno» è in Fraunces', () => {
  it('ha font-serif come il prezzo della scheda prodotto', () => {
    expect(leggi('components/home/DropOfDay.tsx')).toMatch(/text-4xl md:text-5xl font-extrabold font-serif text-accent-300/);
  });
});

describe('292 — la striscia Eventi della home', () => {
  const src = leggi('components/home/HomeEvents.tsx');
  it('non mostra eventi già finiti', () => {
    expect(src).toMatch(/\.or\(`ends_at\.is\.null,ends_at\.gte\.\$\{new Date\(\)\.toISOString\(\)\}`\)/);
  });
  it('non mostra uno sconto che la cassa non applica', () => {
    expect(src).not.toMatch(/-\{e\.discount_percent\}%/);
  });
});

describe('374 — il logo del negozio del mese non si ritaglia a quadrato', () => {
  it('nessun componente chiede sizedImage(…store_logo…, \'thumb\'|\'card\')', async () => {
    const { execSync } = await import('node:child_process');
    const trovati = execSync("grep -rnE \"sizedImage\\([^)]*store_logo[^)]*'(thumb|card)'\" components app || true", { encoding: 'utf8' });
    expect(trovati.trim()).toBe('');
  });
  it('il negozio del mese usa logoNegozio e object-contain', () => {
    const src = leggi('components/home/ShopOfMonthHero.tsx');
    expect(src).toContain('logoNegozio(seller.store_logo, 176)');
    expect(src).toMatch(/className="object-contain w-full h-full"/);
  });
});

import { unaBollaPerNegozio } from '@/components/home/StoriesCarousel';

describe('1721 — una bolla per negozio nel carosello delle storie', () => {
  it('tre storie di Pane Quotidiano fanno una bolla sola, e le sue storie restano in fila', () => {
    const storie = [
      { id: 'pane-1', seller_id: 'pane' }, { id: 'altro-1', seller_id: 'altro' },
      { id: 'pane-2', seller_id: 'pane' }, { id: 'pane-3', seller_id: 'pane' },
    ];
    const { inSequenza, bolle } = unaBollaPerNegozio(storie);
    expect(bolle.map((b) => b.storia.seller_id)).toEqual(['pane', 'altro']);
    expect(inSequenza.map((s) => s.id)).toEqual(['pane-1', 'pane-2', 'pane-3', 'altro-1']);
    expect(bolle[1].indice).toBe(3);
  });
});

describe('1740 — il carosello taglia a 30 dopo aver tolto le storie dei non-negozi', () => {
  it('legge più storie, filtra i negozi approvati e solo poi taglia', () => {
    const src = leggi('components/home/StoriesCarousel.tsx');
    expect(src).toMatch(/\.limit\(STORIE_LETTE\)/);
    expect(src).toMatch(/conNegozioApprovato\(supabase, storie, 'id, store_name, store_logo'\)\)\.slice\(0, STORIE_MOSTRATE\)/);
  });
});

describe('sezioni della home (components/home-sections/HomeSectionRenderer.tsx)', () => {
  const src = leggi('components/home-sections/HomeSectionRenderer.tsx');
  it('294 — la fila senza ordinamento non si chiama «più amati / vanno forte / più visti»', () => {
    expect(src).not.toMatch(/'I più amati'|'Prodotti che vanno forte'|prodotti più visti del momento/);
    expect(src).toContain("c.heading || 'Ultimi arrivati dai negozi'");
  });
  it('2034 — la newsletter non promette un giorno né una cadenza', () => {
    expect(src).not.toMatch(/una volta a settimana|Ogni venerdì/);
  });
  it('2444 — la fascia di tendenza sta in un contenitore che sparisce quando è vuota', () => {
    expect(src).toMatch(/<MaybeSection className=\{`container mx-auto px-4 sm:px-6 \$\{SPAZIO_SEZIONE\}`\}><TrendingNow \/><\/MaybeSection>/);
  });
  it('2453 — mentre carica, «di tendenza» non tiene dodici riquadri che poi spariscono', () => {
    expect(leggi('components/home/TrendingNow.tsx')).toMatch(/if \(isLoading\) return null;/);
  });
});

describe('1629 — «Ultimi visti»', () => {
  it('legge la lista intera e toglie il prodotto aperto al momento di disegnare', () => {
    const src = leggi('components/RecentlyViewed.tsx');
    expect(src).toContain('leggiVistiDiRecente(supabase, { userId: userId! })');
    expect(src).toContain('const visibili = items.filter((it) => it.product.id !== excludeId);');
    expect(src).toContain('visibili.map((it) =>');
  });
});

describe('128/652 — visite e «Ultimi visti»', () => {
  it('128 — senza consenso statistico «Ultimi visti» non si legge, non si mostra e si cancella', () => {
    const src = leggi('components/RecentlyViewed.tsx');
    expect(src).toContain("setConsenso(hasConsent('analytics'))");
    expect(src).toContain("enabled: !!userId && consenso !== false");
    expect(src).toMatch(/if \(consenso !== false \|\| !userId\) return;\s*void supabase\.from\('recently_viewed'\)\.delete\(\)\.eq\('user_id', userId\)/);
    expect(src).toContain('consenso === false ||');
  });
  it('652 — il negoziante che apre il suo prodotto non conta come visita', () => {
    const src = leggi('components/ProductViewTracker.tsx');
    const registra = src.slice(src.indexOf('registra: async () => {'), src.indexOf(".from('product_views')"));
    expect(registra).toMatch(/if \(userId && sellerId && userId === sellerId\) return;/);
  });
});

import { caricatoreLogoNegozio } from '@/components/StoreAvatar';

describe('1549 — lo stesso logo non si taglia in due modi diversi', () => {
  const LOGO = 'https://abc.supabase.co/storage/v1/object/public/logos/pane.png';
  it('il caricatore dei loghi chiede solo la larghezza, mai il ritaglio quadrato', () => {
    const url = new URL(caricatoreLogoNegozio({ src: LOGO, width: 96 }));
    expect(url.searchParams.get('width')).toBe('96');
    expect(url.searchParams.get('height')).toBeNull();
    // Con la sola larghezza Supabase rimpicciolisce e basta: niente altezza, niente quadrato.
  });
  it('StoreAvatar lo usa e tiene il logo intero (object-contain)', () => {
    const src = leggi('components/StoreAvatar.tsx');
    expect(src).toContain('loader={caricatoreLogoNegozio}');
    expect(src).toMatch(/className="object-contain"/);
    expect(src).not.toContain('loader={caricatoreFotoRemote}');
  });
});

describe('670 — le foto già ridotte da Supabase non si riducono di nuovo a Vercel', () => {
  it('foto delle recensioni e loghi delle storie passano da un caricatore', () => {
    expect(leggi('app/product/[id]/page.tsx')).toMatch(/src=\{url\}\s+alt=\{`Foto \$\{i \+ 1\} della recensione`\}[\s\S]{0,240}loader=\{caricatoreFotoRemote\}/);
    expect(leggi('components/store-sections/ReviewsSection.tsx')).toMatch(/src=\{url\}[\s\S]{0,140}loader=\{caricatoreFotoRemote\}/);
    expect(leggi('components/home/StoriesCarousel.tsx')).toContain('loader={caricatoreLogoNegozio}');
    expect(leggi('components/StoryViewer.tsx')).toContain('loader={caricatoreLogoNegozio}');
  });
});

import { togliPromesseSuperate, defaultHomeSite } from '@/lib/home-site';

describe('2638 — il freno delle promesse superate vale per tutte le sezioni della home', () => {
  it('un\'intestazione salvata fuori dall\'eroe con i 30-60 minuti certi si scarta', () => {
    const site = defaultHomeSite();
    const i = site.sections.findIndex((s) => s.type === 'popularProducts');
    (site.sections[i].config as Record<string, unknown>).heading = 'Arriva a casa in 30-60 min';
    const { site: pulita, frasi } = togliPromesseSuperate(site);
    expect((pulita.sections[i].config as Record<string, unknown>).heading).toBe('');
    expect(frasi.map((f) => f.campo)).toContain('heading');
  });
});

describe('2637/672/517 — testi e letture della home', () => {
  it('2637 — il sottotitolo di riserva non promette casa ed elettronica', () => {
    expect(leggi('app/page.tsx')).not.toMatch(/Alimentari, casa, elettronica/);
  });
  it('672 — le categorie precaricate valgono quanto la memoria del server (60 + 300 s)', async () => {
    const { domandaCategoriePubbliche } = await import('@/lib/queries/categorie-pubbliche');
    expect(domandaCategoriePubbliche({} as never).staleTime).toBe(360_000);
  });
  it('517 — le ricerche suggerite a tutti non spingono il vino', () => {
    expect(leggi('components/SearchBar.tsx')).not.toMatch(/'Vino dei Colli'/);
  });
});
