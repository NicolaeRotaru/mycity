import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spiegazioneCommissione } from '@/app/seller/earnings/commissione';
import { TOPICS } from '@/app/seller/help/domande';

/**
 * 31/10/2026 (ondata 4) — LA PAGINA GUADAGNI PROMETTEVA I SOLDI SULL'IBAN
 * «CIRCA UN'ORA DOPO LA CONSEGNA».
 *
 * Un'ora dopo la consegna parte solo lo spostamento interno a Stripe, verso il
 * conto Stripe del negozio: in banca arrivano giorni dopo. E al lancio la carta
 * è spenta: si paga in contanti e il bonifico al negozio parte ogni lunedì, per
 * le consegne della settimana prima (scelta di Nicola del 31/10/2026).
 *
 * La prova legge le frasi che il negozio vede e rifiuta «un'ora» detto della
 * banca o dell'IBAN.
 */

const testoBonifico = (cartaAccesa?: boolean) => {
  const p = (cartaAccesa === undefined ? spiegazioneCommissione() : spiegazioneCommissione(cartaAccesa))
    .find((x) => /bonifico|banca|IBAN|Stripe/i.test(`${x.prima}${x.forte}${x.dopo}`));
  return p ? `${p.prima}${p.forte}${p.dopo}` : '';
};

/** Ogni pezzo di frase che parla di banca o IBAN non deve dire «un'ora». */
function nessunaBancaInUnOra(testo: string) {
  for (const pezzo of testo.split(/[.;:]/)) {
    if (/banca|IBAN|bonifico/i.test(pezzo)) expect(pezzo, `promessa falsa: «${pezzo.trim()}»`).not.toMatch(/un'ora/);
  }
}

describe('quando arrivano i soldi al negozio', () => {
  it('carta spenta (il lancio): bonifico ogni lunedì per la settimana prima, niente «un ora»', () => {
    const t = testoBonifico(false);
    expect(t).toMatch(/luned/);
    expect(t).toContain('settimana prima');
    expect(t).not.toMatch(/un'ora/);
  });

  it('la pagina com è oggi (carta spenta) dice il lunedì', () => {
    expect(testoBonifico()).toMatch(/luned/);
  });

  it('carta accesa: un ora dopo va sul conto Stripe, in banca dopo, col calendario di Stripe', () => {
    const t = testoBonifico(true);
    expect(t).toMatch(/un'ora dopo la consegna/i);
    expect(t).toMatch(/conto Stripe/);
    expect(t).toMatch(/banca/);
    nessunaBancaInUnOra(t);
  });

  it('le domande frequenti dicono la stessa cosa della pagina Guadagni', () => {
    const r = TOPICS.flatMap((t) => t.items).find((i) => /quando ricevo i soldi/i.test(i.q));
    expect(r).toBeTruthy();
    expect(r!.a).not.toMatch(/giorno 5/);
    expect(r!.a).toMatch(/luned/);
    nessunaBancaInUnOra(r!.a);
  });

  it('la pagina Guadagni non scrive più «Pagamento automatico … verso l IBAN»', () => {
    const pagina = readFileSync('app/seller/earnings/page.tsx', 'utf8');
    expect(pagina).not.toMatch(/Pagamento automatico \{fraseAttesaBonifico\(\)\}/);
    expect(pagina).toMatch(/tema === 'bonifico'/);
  });
});
