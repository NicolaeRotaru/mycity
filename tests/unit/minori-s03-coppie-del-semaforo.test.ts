import { describe, expect, it } from 'vitest';
import { esitoVariabili, COPPIE_INTERE_O_GUASTO } from '@/lib/health-env';

/** S03 — scheda 1591: una coppia con una metà fuori dall'elenco delle attese non resta verde in silenzio. */
describe('il semaforo delle variabili e le coppie', () => {
  it('se una metà della coppia VAPID esce dall elenco, il verdetto non è verde', () => {
    const coppia = COPPIE_INTERE_O_GUASTO.find((c) => c.variabili.includes('VAPID_PRIVATE_KEY'))!;
    const attese = ['VAPID_PRIVATE_KEY'];
    const esito = esitoVariabili({ VAPID_PRIVATE_KEY: 'presente' }, attese, [coppia]);
    expect(esito.ok).toBe(false);
    expect(esito.stato).toBe('non_misurate');
    expect(esito.error).toMatch(/NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
    expect(esito.esaminate).toBe(1);
  });

  it('controprova: con tutte e due nell elenco e presenti, è verde', () => {
    const coppia = COPPIE_INTERE_O_GUASTO.find((c) => c.variabili.includes('VAPID_PRIVATE_KEY'))!;
    const esito = esitoVariabili({ VAPID_PRIVATE_KEY: 'presente', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'presente' }, [...coppia.variabili], [coppia]);
    expect(esito.ok).toBe(true);
  });
});
