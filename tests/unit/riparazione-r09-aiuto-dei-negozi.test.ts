import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOPICS } from '@/app/seller/help/domande';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';

// R09-021 — Nell'aiuto per i negozi restavano «payout», «evaderlo» e «rider», una risposta parlava
// di prodotti sponsorizzati che oggi sono sospesi, e le domande erano righe alte 24 px.
const risposte = TOPICS.flatMap((t) => t.items.map((i) => `${i.q} ${i.a}`)).join('\n');
const pagina = readFileSync('app/seller/help/page.tsx', 'utf8');

describe('R09-021 · l’aiuto dei negozi parla come il negoziante', () => {
  it('nessuna parola da addetti ai lavori', () => {
    // Le etichette dei pulsanti fra virgolette («"Pronto per il rider"») sono quelle vere dello schermo,
    // e vengono da lib/order-status.ts: si citano come sono. Il resto del testo parla italiano.
    const senzaEtichette = risposte.replace(/"[^"]*"/g, '""');
    expect(senzaEtichette).not.toMatch(/payout|evader|\brider\b/i);
    expect(risposte).toContain('prossimo pagamento che ti facciamo');
  });
  it('il rifiuto non promette un rimborso a chi paga alla consegna', () => {
    expect(risposte).not.toMatch(/Il cliente riceve rimborso automatico/);
    expect(risposte).toMatch(/se paga alla consegna non ha pagato niente/);
  });
  it('le sponsorizzate compaiono solo quando sono accese', () => {
    expect(/sponsorizzat/i.test(risposte)).toBe(ABBONAMENTO_NEGOZI_ACCESO);
  });
  it('le domande sono bersagli alti almeno 44 px', () => {
    expect(pagina).toMatch(/<summary className="[^"]*\bmin-h-11\b/);
  });
});
