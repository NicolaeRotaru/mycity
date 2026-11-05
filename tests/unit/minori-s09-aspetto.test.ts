/**
 * S09 — Prove leggere (lettura del sorgente) sulle correzioni di aspetto e di
 * accessibilità di vetrina, scheda prodotto, home e pagine pubbliche.
 * Ogni blocco nomina la scheda che difende.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const leggi = (p: string) => readFileSync(p, 'utf8');

describe('1021 — stesso passo orizzontale lungo il percorso', () => {
  it('/categorie usa la larghezza del catalogo e il passo px-4 sm:px-6', () => {
    const src = leggi('app/categorie/page.tsx');
    expect(src).not.toMatch(/max-w-5xl/);
    expect(src).toMatch(/container mx-auto px-4 sm:px-6 py-8 (space-y-6 )?max-w-7xl/);
  });
  it('la vetrina del negozio usa lo stesso passo px-4 sm:px-6', async () => {
    const { CONTENITORE_PAGINA_NEGOZIO } = await import('@/components/store-sections/misure-vetrina');
    expect(CONTENITORE_PAGINA_NEGOZIO).toContain('px-4 sm:px-6');
  });
});

describe('236/270 — il catalogo nella vetrina del negozio', () => {
  const src = leggi('components/StoreProductExplorer.tsx');
  it('236 — il pulsante Filtri ha un nome anche quando il testo è nascosto sul telefono', () => {
    const bottone = src.slice(src.indexOf('onClick={() => setShowFilters'), src.indexOf('</button>', src.indexOf('onClick={() => setShowFilters')));
    expect(bottone).toContain(": 'Filtri'}");
    expect(bottone).toContain('aria-label=');
    expect(bottone).toMatch(/<Filter [^>]*aria-hidden/);
  });
  it('270 — alla griglia arriva il termine dopo la pausa, non quello di ogni lettera', () => {
    expect(src).toMatch(/setTimeout\(\(\) => setTermine\(search\.trim\(\)\), 250\)/);
    expect(src).toMatch(/search=\{termine \|\| undefined\}/);
  });
  it('270 — la griglia conta una ricerca solo coi risultati del suo termine', () => {
    const griglia = leggi('components/ProductGrid.tsx');
    expect(griglia).toMatch(/if \(!term \|\| caricando \|\| domanda\.isPlaceholderData\) return;/);
  });
});

describe('pagina di una categoria (app/category/[slug]/page.tsx)', () => {
  const src = leggi('app/category/[slug]/page.tsx');
  it('1936 — niente più filtro col camioncino «da 30 €» della vecchia soglia', () => {
    expect(src).not.toMatch(/freeShipping/);
    expect(src).not.toMatch(/\?\s*30\s*:/);
    expect(src).not.toMatch(/\bTruck\b/);
  });
  it('284 — «Altri prodotti» legge solo la madre, senza le figlie già mostrate nelle loro file', () => {
    const altri = src.slice(src.lastIndexOf('<ProductGrid', src.indexOf('title="Altri prodotti"')), src.indexOf('title="Altri prodotti"'));
    expect(altri).toContain('categoryIds={[category.id]}');
    expect(altri).not.toMatch(/categoryId=\{category\.id\}/);
  });
  it('330 — se tutte le file dell\'hub sono vuote compare un messaggio con le vie d\'uscita', () => {
    expect(src).toMatch(/onCount=\{\(n\) => segnaConto\(s\.id, n\)\}/);
    expect(src).toMatch(/\.every\(\(fila\) => contiDelleFile\[fila\] === 0\)/);
    expect(src).toContain('href="/categorie"');
    expect(src).toContain('href="/search"');
  });
});

describe('924 — le foto sotto la piega non sono «urgenti»', () => {
  it('la fila delle promo in home non chiede priority', () => {
    expect(leggi('components/home/PromoDeals.tsx')).not.toMatch(/priority=\{i < \d\}/);
  });
  it('le collezioni del negozio non la chiedono', () => {
    expect(leggi('components/store-sections/CollectionSection.tsx')).toContain('prioritaPrimeFoto={false}');
  });
});

describe('barra delle categorie (components/CategoryBar.tsx)', () => {
  const src = leggi('components/CategoryBar.tsx');
  it('309 — il pannello elenca solo le categorie piene, come home e piede', () => {
    expect(src).toContain('useQuery(domandaCategoriePiene(supabase))');
    expect(src).toMatch(/const tops = catVisibili\.filter/);
    expect(src).toMatch(/const childrenOf = \(id: string\) => catVisibili\.filter/);
  });
  it('234 — né «Tutte le categorie» né «Menu account» si annunciano come menu', () => {
    expect(src).not.toMatch(/aria-haspopup=/);
    const nav = leggi('components/Navbar.tsx');
    const account = nav.slice(nav.indexOf('aria-label="Menu account"') - 400, nav.indexOf('aria-label="Menu account"') + 200);
    expect(account).not.toMatch(/aria-haspopup="(true|menu)"/);
  });
  it('1558 — il fuoco va al primo elemento visibile, X compresa', () => {
    expect(src).toContain("querySelectorAll<HTMLElement>('button, a[href]')");
    expect(src).toMatch(/getComputedStyle\(el\)\.display !== 'none'/);
  });
});

describe('1604 — tessere delle categorie senza foto', () => {
  it('il velo scuro pieno c\'è solo sopra una foto', () => {
    const src = leggi('components/CategoryShowcase.tsx');
    expect(src).toMatch(/foto\.src \? 'from-black\/70 via-black\/15 to-black\/25' : 'from-black\/35 via-transparent to-transparent'/);
    expect(src).not.toMatch(/<div className="absolute inset-0 bg-gradient-to-t from-black\/70 via-black\/15 to-black\/25" \/>/);
  });
});

describe('scheda prodotto — recensioni (app/product/[id]/page.tsx)', () => {
  const src = leggi('app/product/[id]/page.tsx');
  it('287 — il messaggio dei +20 punti dipende dall\'interruttore dei punti', () => {
    expect(src).toMatch(/reviewPhotos\.length > 0 && INVITI_E_PUNTI_ACCESI\s*\n?\s*\? `Grazie! Recensione pubblicata · \+20 punti/);
  });
  it('158 — chi non ha ricevuto il prodotto legge «dopo averlo ricevuto» invece del modulo', () => {
    expect(src).toMatch(/haRicevutoIlProdotto === false \? \(\s*<p[^>]*>Puoi recensire questo prodotto dopo averlo ricevuto\.<\/p>/);
    expect(src).toMatch(/queryKey: \['reviews', 'puo-recensire', id, profile\?\.id \?\? ''\]/);
  });
  it('516 — la scheda dice come verifichiamo le recensioni', () => {
    expect(src).toContain('Pubblicano recensioni solo i clienti con un ordine consegnato di questo prodotto.');
    expect(src).toMatch(/INVITI_E_PUNTI_ACCESI && ' Chi aggiunge una foto riceve 20 punti fedeltà\.'/);
  });
});

describe('894 — il cuore «non nei preferiti» della scheda prodotto si vede', () => {
  it('usa ink-400 come la card, non ink-300', async () => {
    const { classiBottoneCuore } = await import('@/lib/design/cuore-preferito');
    expect(classiBottoneCuore(false)).toContain('text-ink-400');
    expect(classiBottoneCuore(false)).not.toContain('text-ink-300');
  });
});

describe('scheda prodotto — acquisto (app/product/[id]/page.tsx)', () => {
  const src = leggi('app/product/[id]/page.tsx');
  const compraOra = src.slice(src.indexOf('const handleBuyNow = () => {'), src.indexOf("router.push('/checkout');"));
  it('572 — un secondo tocco su «Compra ora» non aggiunge di nuovo', () => {
    expect(compraOra).toMatch(/if \(inPartenza\) return;/);
    expect(compraOra).toMatch(/setInPartenza\(true\)/);
    expect(src).toMatch(/disabled=\{!canAdd \|\| inPartenza\}/);
  });
  it('572 — «Compra ora» porta la riga alla quantità scelta invece di sommarla', () => {
    expect(compraOra).toMatch(/if \(giaNelCarrello\) \{\s*updateQuantity\(product\.id, qty, selectedVariant\?\.id\);/);
  });
  it('663 — i messaggi delle varianti stanno in una regione che si annuncia', () => {
    const blocco = src.slice(src.indexOf('SELETTORE VARIANTI'), src.indexOf('Variante esaurita'));
    expect(blocco).toMatch(/<div role="status" aria-live="polite">/);
  });
  it('405 — la scheda non dice più che consegna il negozio', () => {
    expect(src).not.toContain('Venduto e consegnato da');
    expect(src).toMatch(/Venduto da <strong[^>]*>\{product\.profiles\?\.store_name\}<\/strong> · consegna MyCity/);
  });
});

describe('anteprime WhatsApp di prodotto e negozio (opengraph-image)', () => {
  for (const f of ['app/store/[id]/opengraph-image.tsx', 'app/product/[id]/opengraph-image.tsx']) {
    const src = leggi(f);
    it(`316 — ${f}: il marchio in Fraunces 800, niente peso 900`, () => {
      expect(src).toContain('fonts: await caratteriDelMarchio()');
      expect(src).toMatch(/fontFamily: MARCHIO_FONT_FAMILY, fontWeight: MARCHIO_FONT_WEIGHT, color: '#F4BC53' \}\}>My</);
      expect(src).not.toMatch(/fontWeight: 900/);
    });
    it(`375 — ${f}: l'immagine non si dichiara immutabile per un anno`, () => {
      expect(src).toContain("headers: { 'cache-control': CACHE_ANTEPRIMA }");
      expect(src).toMatch(/CACHE_ANTEPRIMA = 'public, max-age=300/);
    });
  }
});

describe('domande sotto il prodotto (components/ProductQA.tsx)', () => {
  const src = leggi('components/ProductQA.tsx');
  it('151 — non promette una notifica che nessuno manda', () => {
    expect(src).not.toMatch(/Riceverai una notifica/);
    expect(src).not.toMatch(/ti risponderà al più presto/);
  });
  it('120 — niente bollino «Venditore verificato» incondizionato', () => {
    expect(src).not.toMatch(/>\s*Venditore verificato/);
  });
  it('367 — niente pulsante «Utile» con un conteggio finto', () => {
    expect(src).not.toMatch(/helpfulVotes|Utile\{/);
  });
  it('366 — una lettura caduta non diventa «Nessuna domanda ancora»', () => {
    expect(src).toMatch(/\) : isError \? \(/);
    expect(src.indexOf(') : isError ? (')).toBeLessThan(src.indexOf('Nessuna domanda ancora'));
  });
});

describe('pagina di ricerca (app/search/page.tsx)', () => {
  const src = leggi('app/search/page.tsx');
  it('414 — un ordinamento sconosciuto nell\'indirizzo torna a «pertinenza»', () => {
    expect(src).toMatch(/SORT_OPTIONS\.includes\(grezzo as SortOption\) \? \(grezzo as SortOption\) : 'relevance'/);
    expect(src).not.toMatch(/\(params\.get\('ordine'\) as SortOption\) \?\? 'relevance'/);
  });
  it('239 — i pulsanti del voto minimo dicono quale è scelto', () => {
    const voto = src.slice(src.indexOf('{[0, 3, 4, 4.5].map((r) => ('), src.indexOf("t('ratingAll')"));
    expect(voto).toContain('type="button"');
    expect(voto).toContain('aria-pressed={minRating === r}');
  });
});

describe('«Venduto da» sotto la scheda prodotto (components/products/SellerCard.tsx)', () => {
  const src = leggi('components/products/SellerCard.tsx');
  it('345 — l\'anno di iscrizione si dice «su MyCity dal», non «dal» come la fondazione', () => {
    expect(src).toContain('· su MyCity dal {memberSince}');
  });
  it('432 — il bottone Segui non dice mai «Non lo so»', () => {
    expect(src).not.toMatch(/'Non lo so'/);
  });
  it('283 — niente percentuale «in tempo» calcolata sugli ordini che vede chi guarda', () => {
    expect(src).not.toMatch(/onTimePct|in tempo\n|ONTIME_WINDOW_MS/);
    expect(src).not.toMatch(/\.from\('orders'\)/);
  });
});
