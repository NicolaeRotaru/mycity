/**
 * S09 — La pagina «Negozi» e gli orari dei negozi (schede 1767, 1552, 336).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { conLeMadri } from '@/lib/queries/categorie-dei-negozi';
import { DAY_KEYS, romeNow } from '@/lib/store-hours';

describe('1767 — il filtro per categoria non fa sparire il forno', () => {
  const madreDi = new Map<string, string | null>([['c-ali', null], ['c-panificio', 'c-ali'], ['c-casa', null]]);
  it('un negozio coi prodotti solo in Panificio risulta anche in Alimentari', () => {
    const cats = conLeMadri(['c-panificio'], madreDi);
    expect(cats.has('c-ali')).toBe(true);
    expect(cats.has('c-casa')).toBe(false);
  });
  it('la pagina allarga le categorie di ogni negozio alle madri', () => {
    const src = readFileSync('app/stores/page.tsx', 'utf8');
    expect(src).toMatch(/categoriesByStore\[id\] = conLeMadri\(categoriesByStore\[id\], madreDi\)/);
  });
});

describe('1552 — oltre il tetto il conteggio non si spaccia per il totale', () => {
  it('a 200 negozi la riga dice «almeno 200»', () => {
    const src = readFileSync('app/stores/page.tsx', 'utf8');
    expect(src).toMatch(/stores\.length >= TETTO_NEGOZI\s*\?\s*`Almeno \$\{TETTO_NEGOZI\} negozi locali/);
  });
});

describe('336 — il giorno della settimana è quello di Piacenza', () => {
  it('nessuna scheda negozio prende il giorno dall\'orologio del dispositivo', () => {
    for (const f of [
      'components/StoreListRow.tsx', 'components/StorePreviewCard.tsx', 'components/home/HeroStoreCard.tsx',
      'components/ProductGrid.tsx', 'app/stores/page.tsx', 'components/store-sections/HeroSection.tsx',
      'components/store-sections/HoursSection.tsx',
    ]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/DAY_KEYS\[new Date\(\)\.getDay\(\)\]/);
    }
  });
  it('alle 23:30 UTC di domenica a Roma è già lunedì', () => {
    expect(DAY_KEYS[romeNow(new Date('2026-11-08T23:30:00Z')).getDay()]).toBe(DAY_KEYS[1]);
  });
});

import { descrizioneDelNegozio, tagliaAParola } from '@/lib/queries/metadati-vetrina';
import { fraseComeArriva } from '@/lib/promesse-pubbliche';

describe('2308 — la descrizione di un negozio dal nome lungo tiene la condizione della veloce', () => {
  it('con «Macelleria Salumeria Da Gianni» resta «con un fattorino in servizio», entro 160', () => {
    const d = descrizioneDelNegozio('Macelleria Salumeria Da Gianni', null, fraseComeArriva());
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toContain(fraseComeArriva());
  });
  it('anche con un nome di 60 caratteri la frase della consegna resta intera', () => {
    const d = descrizioneDelNegozio('Antica Bottega Alimentare dei Fratelli Rossi di Piacenza Centro', null, fraseComeArriva());
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith(fraseComeArriva())).toBe(true);
  });
  it('una descrizione scritta dal negozio si taglia sull\'ultima parola intera', () => {
    const t = tagliaAParola('parola '.repeat(40), 160);
    expect(t.length).toBeLessThanOrEqual(160);
    expect(t.endsWith('parola…')).toBe(true);
  });
  it('il layout del negozio usa questa regola', () => {
    expect(readFileSync('app/store/[id]/layout.tsx', 'utf8')).toContain('descrizioneDelNegozio(name, store.store_description, fraseComeArriva())');
  });
});

describe('scheda negozio in home (components/StorePreviewCard.tsx)', () => {
  const src = readFileSync('components/StorePreviewCard.tsx', 'utf8');
  it('2270 — la pillola dice solo aperto/chiuso, la consegna sta in una riga con l\'altezza tenuta', () => {
    expect(src).toMatch(/const stato = open \? 'Aperto ora' : 'Chiuso ora';/);
    expect(src).toMatch(/min-h-\[1rem\][^>]*>\s*\{consegna \? `consegna \$\{consegna\}` : ''\}/);
  });
  it('237 — niente pallini (pulsanti) dentro il link della scheda; etichette «Foto N di M»', () => {
    expect(src).toMatch(/<StoreMediaCarousel\s+media=\{media\}\s+posto=\{posto\}\s+senzaPallini/);
    const carosello = readFileSync('components/StoreMediaCarousel.tsx', 'utf8');
    expect(carosello).toContain('media.length > 1 && !senzaPallini');
    expect(carosello).not.toContain('`Slide ${i + 1}`');
    expect(carosello).toContain('`Foto ${i + 1} di ${media.length}`');
  });
});
