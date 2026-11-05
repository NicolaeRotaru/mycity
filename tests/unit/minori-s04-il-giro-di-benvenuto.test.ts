import { describe, it, expect } from 'vitest';
import { Gift } from 'lucide-react';
import { PASSI_DEL_GIRO } from '@/components/BuyerOnboardingTour';
import { fraseComeSiPaga } from '@/lib/promesse-pubbliche';

/**
 * 5/11/2026 (S04) — Il giro di benvenuto del cliente.
 *  - 1902: il primo passo diceva a mano «paghi alla consegna», il terzo prende il modo di pagare
 *    dalla cassa: con la carta accesa i due passi si contraddicono. Il modo di pagare si dice una
 *    volta sola, con la frase della cassa.
 *  - 1903: l'icona del pacco regalo restava sul benvenuto anche dopo che il regalo era stato tolto.
 */
type Passo = { icon: unknown; title: string; body: string };
const passi = PASSI_DEL_GIRO as Passo[];

describe('il giro di benvenuto', () => {
  it('il modo di pagare lo dice solo la frase della cassa, mai a mano (1902)', () => {
    for (const p of passi) {
      const resto = `${p.title} ${p.body}`.replace(fraseComeSiPaga(), ' ');
      expect(resto, p.title).not.toMatch(/pagh|pagar|pagament|alla consegna/i);
    }
    expect(passi.map((p) => p.body).join(' ')).toContain(fraseComeSiPaga());
  });

  it('nessun passo mostra il pacco regalo (1903)', () => {
    for (const p of passi) expect(p.icon, p.title).not.toBe(Gift);
  });
});

describe('l’etichetta della newsletter in home (1903)', () => {
  it('non porta il pacco regalo: nessun regalo all’iscrizione', async () => {
    const { readFileSync } = await import('node:fs');
    const sorgente = readFileSync('components/home-sections/HomeSectionRenderer.tsx', 'utf8');
    const fascia = sorgente.slice(sorgente.indexOf("case 'newsletter'"), sorgente.indexOf('</span>', sorgente.indexOf("case 'newsletter'")));
    expect(fascia.length).toBeGreaterThan(0);
    expect(fascia).not.toMatch(/<Gift\b/);
  });
});
