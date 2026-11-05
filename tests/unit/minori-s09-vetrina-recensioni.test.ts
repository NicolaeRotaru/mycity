/**
 * S09 — Le recensioni nella vetrina del negozio (schede 650, 325, 2407, 371, 274, 320).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { riepilogoRecensioni } from '@/components/store-sections/riepilogo-recensioni';

const recensione = (rating: number) => ({
  id: `r${Math.random()}`, rating, comment: null, created_at: '2026-11-01', seller_reply: null,
  user_id: null, order_id: null, photo_urls: null, helpful_count: 0, author: null,
});

describe('650 — media e numero veri, non le ultime 20', () => {
  it('con 30 recensioni nel database dichiara 30 anche se ne ha lette 20', () => {
    const lette = Array.from({ length: 20 }, () => recensione(5));
    expect(riepilogoRecensioni({ reviews: lette, riepilogoRecensioni: { media: 4.6, totale: 30 } })).toEqual({ media: 4.6, totale: 30 });
  });
  it('se il conto vero non c\'è ripiega sulle lette', () => {
    expect(riepilogoRecensioni({ reviews: [recensione(4), recensione(5)], riepilogoRecensioni: null })).toEqual({ media: 4.5, totale: 2 });
  });
  it('vetrina, intestazione, linguetta e dati per Google usano il riepilogo', () => {
    expect(readFileSync('components/store-sections/HeroSection.tsx', 'utf8')).toContain('riepilogoRecensioni(ctx)');
    expect(readFileSync('components/store-sections/SectionRenderer.tsx', 'utf8')).toMatch(/riepilogoRecensioni\(ctx\)\?\.totale/);
    expect(readFileSync('components/store-sections/ReviewsSection.tsx', 'utf8')).toMatch(/riepilogo\?\.totale \?\? reviews\.length/);
    const pagina = readFileSync('app/store/[id]/page.tsx', 'utf8');
    expect(pagina).toMatch(/reviewCount: riepilogo\.totale/);
    expect(readFileSync('components/store-sections/useStorePageData.ts', 'utf8')).toContain("supabase.rpc('store_review_stats', { p_store_ids: [id] })");
  });
});

describe('le altre correzioni della vetrina', () => {
  const sezione = readFileSync('components/store-sections/ReviewsSection.tsx', 'utf8');
  const dati = readFileSync('components/store-sections/useStorePageData.ts', 'utf8');
  it('325 — «Mostra altre recensioni» rende leggibili quelle oltre le prime sei', () => {
    expect(sezione).toMatch(/const mostrate = tutte \? reviews : reviews\.slice\(0, RECENSIONI_SUBITO\)/);
    expect(sezione).toContain('Mostra altre recensioni');
  });
  it('2407 — la lettura delle recensioni non ignora l\'errore, e la sezione lo dice', () => {
    const lettura = dati.slice(dati.indexOf(".from('store_reviews')"), dati.indexOf('const rows ='));
    expect(lettura).toMatch(/if \(error\) throw error;/);
    expect(sezione).toContain('Non riusciamo a caricare le recensioni');
  });
  it('371 — una lettura sola dei voti «Utile», l\'utente letto una volta', () => {
    expect(sezione).not.toMatch(/supabase\.auth\.getUser\(\)/);
    expect(sezione).toMatch(/\.in\('review_id', ids\)/);
    expect(sezione).toContain('useUtente()');
  });
  it('274 — l\'indirizzo del negozio per Google non dipende da window', () => {
    const pagina = readFileSync('app/store/[id]/page.tsx', 'utf8');
    expect(pagina).not.toMatch(/url: typeof window/);
    expect(pagina).toMatch(/url: `\$\{INDIRIZZO_DEL_SITO\}\/store\/\$\{id\}`/);
  });
  it('320 — la pagina in più di un negozio distingue la rete caduta da «non trovata»', () => {
    const pagina = readFileSync('app/store/[id]/[slug]/page.tsx', 'utf8');
    const errore = pagina.indexOf('if (data.isError)');
    expect(errore).toBeGreaterThan(-1);
    expect(errore).toBeLessThan(pagina.indexOf('if (!data.approved || !data.ctx || !data.store) return notFound;'));
  });
});
