/**
 * R16-003 — i riquadri `bg-white border border-cream-300 rounded-*` scritti a mano nei file della sessione
 * diventano <Card> con gli stessi raggi e padding (Card copre già lg, xl e 2xl: nessun raggio da aggiungere).
 * Prova leggera: nei file convertiti non resta un <div> a mano con quello schema; Card è importata.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONVERTITI = ['app/faq/page.tsx', 'app/stores/page.tsx', 'app/contact/page.tsx', 'app/seller/profile/page.tsx'];
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

describe('R16-003 · riquadri a mano -> Card', () => {
  it.each(CONVERTITI)('%s usa Card e non ha più <div> a mano con bg-white border-cream-300 rounded-*', (f) => {
    const src = leggi(f);
    expect(src).toContain("import { Card } from '@/components/ui/Card'");
    expect(src).toContain('<Card');
    const aMano = src.split('\n').filter((r) => /<div\b[^>]*className="[^"]*bg-white border border-cream-300 rounded-(lg|xl|2xl)/.test(r));
    expect(aMano).toEqual([]);
  });
  it('Card copre i tre raggi usati a mano', () => {
    const src = leggi('components/ui/Card.tsx');
    expect(src).toContain("'rounded-lg'");
    expect(src).toContain("'rounded-xl'");
    expect(src).toContain("'rounded-2xl'");
  });
});
