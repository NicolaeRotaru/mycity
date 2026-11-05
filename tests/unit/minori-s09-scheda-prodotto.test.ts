/**
 * S09 — Letture della scheda prodotto (lib/queries/catalogo.ts).
 */
import { describe, it, expect } from 'vitest';
import { leggiRigaDelProdotto } from '@/lib/queries/catalogo';

function clienteCheRisponde(risposta: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => risposta;
  return { from: () => q } as never;
}

describe('1678 — un link a un prodotto tagliato a metà', () => {
  it('è «non trovato», non un errore di rete da riprovare', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
    await expect(leggiRigaDelProdotto(supa, '3f2a1c9e-7b')).resolves.toBeNull();
  });
  it('un errore vero resta un errore', async () => {
    const supa = clienteCheRisponde({ data: null, error: { code: '08006', message: 'connessione persa' } });
    await expect(leggiRigaDelProdotto(supa, '3f2a1c9e-7b')).rejects.toBeTruthy();
  });
});

import { disponibilitaPerGoogle } from '@/lib/queries/metadati-vetrina';
import { readFileSync } from 'node:fs';

describe('565 — per Google un prodotto a scorte illimitate è disponibile', () => {
  it('stock nullo → InStock', () => {
    expect(disponibilitaPerGoogle({ status: 'available', stock: null })).toBe('https://schema.org/InStock');
  });
  it('stock zero o prodotto non in vendita → OutOfStock', () => {
    expect(disponibilitaPerGoogle({ status: 'available', stock: 0 })).toBe('https://schema.org/OutOfStock');
    expect(disponibilitaPerGoogle({ status: 'sold', stock: null })).toBe('https://schema.org/OutOfStock');
  });
  it('il guscio della scheda usa questa regola, con url e sku', () => {
    const src = readFileSync('app/product/[id]/layout.tsx', 'utf8');
    expect(src).toContain('availability: disponibilitaPerGoogle(product)');
    expect(src).toMatch(/sku: product\.id/);
    expect(src).toMatch(/url: `\$\{env\.appUrl\(\)\}\/product\/\$\{product\.id\}`/);
  });
});

describe('567 — le pagine «non trovato» non ereditano il canonical della home', () => {
  it('prodotto, negozio, pagina del negozio e categoria', () => {
    for (const f of ['app/product/[id]/layout.tsx', 'app/store/[id]/layout.tsx', 'app/store/[id]/[slug]/layout.tsx', 'app/category/[slug]/layout.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/non trovat[oa] · MyCity', robots: \{ index: false \}, alternates: \{ canonical: null \}/);
    }
  });
});

describe('300/413 — la scheda prodotto', () => {
  const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
  it('300 — se le varianti non si leggono lo dice e offre Riprova', () => {
    expect(src).toMatch(/isError: variantiInErrore, refetch: rileggiVarianti/);
    expect(src).toMatch(/hasVariants && variantiInErrore && optionGroups\.length === 0 &&/);
  });
  it('413 — il prodotto che non si legge non «non esiste»: può essere finito per oggi', () => {
    expect(src).not.toContain('Questo prodotto non esiste o è stato rimosso.');
    expect(src).toContain('può essere finito per oggi');
    expect(src).toContain('<Button href="/stores">Vedi i negozi</Button>');
  });
});

import { leggiSchedaPerIlGuscio } from '@/lib/queries/scheda-con-venduto-da';

describe('1677 — il guscio non mette in cache una scheda vuota', () => {
  it('se l\'estraneo non vede il prodotto, il browser rilegge con la sua sessione', async () => {
    const supa = clienteCheRisponde({ data: null, error: null });
    await expect(leggiSchedaPerIlGuscio(supa, 'bozza-del-forno')).resolves.toEqual([]);
  });
});

import { motivoDellErrore } from '@/components/products/VendutoDa';

describe('2622 — il registro di «Venduto da» tiene il motivo vero', () => {
  it('l\'errore di PostgREST (oggetto semplice) non diventa «[object Object]»', () => {
    expect(motivoDellErrore({ message: 'permission denied for view', code: '42501' })).toBe('permission denied for view');
    expect(motivoDellErrore(new Error('rete'))).toBe('rete');
  });
});

describe('310 — con una promozione il prezzo grande è quello che si paga', () => {
  const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
  it('il prezzo mostrato è scontato come in cassa, col pieno barrato', () => {
    expect(src).toMatch(/const price = scontoPromo > 0 \? discountedUnitCents\(prezzoPieno, scontoPromo\) \/ 100 : prezzoPieno;/);
    expect(src).toMatch(/scontoPromo > 0 && \(\s*<span className="text-lg text-ink-400 line-through">/);
  });
  it('al carrello va il prezzo pieno: lo sconto lo applica lui, non due volte', () => {
    expect(src.match(/price: prezzoPieno,/g)?.length).toBe(2);
  });
  it('barra fissa e riquadro d\'acquisto usano lo stesso prezzo', () => {
    expect(src).toMatch(/<StickyAddToCart\s+price=\{price\}/);
  });
});
