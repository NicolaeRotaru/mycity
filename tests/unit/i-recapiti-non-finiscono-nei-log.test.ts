import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — IL FILTRO DIFENDEVA I NOMI CHE NESSUNO USA.
 *
 * Le chiavi da oscurare si confrontavano per uguaglianza esatta: oscurava
 * `phone`, lasciava passare `delivery_phone`. Ma nel codice vero i campi si
 * chiamano `delivery_phone`, `billing_iban`, `delivery_address`,
 * `delivery_full_name` — mai `phone` da solo.
 *
 * Quello che passa finisce in Sentry, che sta fuori dall'Europa, e da lì non
 * lo togli più.
 *
 * Questa prova passa un ordine vero, coi nomi veri delle colonne, e pretende
 * che niente esca in chiaro. Riancorare il confronto («^…$») e torna rossa.
 */

const consoleInfo = vi.fn();
const consoleError = vi.fn();

describe('i recapiti non finiscono nei log', () => {
  beforeEach(() => {
    vi.resetModules();
    consoleInfo.mockClear();
    consoleError.mockClear();
    vi.spyOn(console, 'info').mockImplementation(consoleInfo);
    vi.spyOn(console, 'error').mockImplementation(consoleError);
    vi.spyOn(console, 'log').mockImplementation(consoleInfo);
    vi.spyOn(console, 'warn').mockImplementation(consoleInfo);
  });

  const ORDINE_VERO = {
    id: 'ord_1',
    delivery_full_name: 'Maria Rossi',
    delivery_phone: '3331234567',
    delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza',
    billing_iban: 'IT60X0542811101000000123456',
    customer_email: 'maria@example.it',
    stripe_customer_id: 'cus_123',
    total_price: 42,
  };

  it('nessun recapito dell’ordine esce in chiaro', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('ordine creato', ORDINE_VERO);

    const scritto = JSON.stringify([...consoleInfo.mock.calls, ...consoleError.mock.calls]);

    expect(scritto).not.toContain('Maria Rossi');
    expect(scritto).not.toContain('3331234567');
    expect(scritto).not.toContain('Via Verdi 10');
    expect(scritto).not.toContain('IT60X0542811101000000123456');
    expect(scritto).not.toContain('maria@example.it');
  });

  it('quello che NON è un dato personale resta leggibile', async () => {
    // Un filtro che oscura tutto è un filtro che qualcuno spegne. L'ordine e
    // il totale devono restare: sono quello che serve per capire cosa è
    // successo.
    const { logger } = await import('@/lib/logger');
    logger.info('ordine creato', ORDINE_VERO);

    const scritto = JSON.stringify([...consoleInfo.mock.calls, ...consoleError.mock.calls]);
    expect(scritto).toContain('ord_1');
    expect(scritto).toContain('42');
  });

  it('anche annidati in profondità', async () => {
    const { logger } = await import('@/lib/logger');
    logger.error('rimborso fallito', {
      ordine: { spedizione: { delivery_phone: '3339999999' } },
    });

    const scritto = JSON.stringify(consoleError.mock.calls);
    expect(scritto).not.toContain('3339999999');
  });

  it('dentro un elenco di ordini, non solo su uno', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('lotto', { ordini: [ORDINE_VERO, { ...ORDINE_VERO, id: 'ord_2' }] });

    const scritto = JSON.stringify(consoleInfo.mock.calls);
    expect(scritto).not.toContain('3331234567');
    expect(scritto).toContain('ord_2');
  });

  it('i nomi vecchi restano coperti: non ho scambiato una difesa con un’altra', async () => {
    const { logger } = await import('@/lib/logger');
    logger.info('vecchi nomi', {
      email: 'x@y.it',
      phone: '3331112222',
      iban: 'IT00',
      token: 'segretissimo',
      password: 'ciao',
    });

    const scritto = JSON.stringify(consoleInfo.mock.calls);
    expect(scritto).not.toContain('x@y.it');
    expect(scritto).not.toContain('3331112222');
    expect(scritto).not.toContain('segretissimo');
    expect(scritto).not.toContain('ciao');
  });
});
