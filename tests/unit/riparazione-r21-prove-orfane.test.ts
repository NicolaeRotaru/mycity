import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

/**
 * R21-013 — LE FOTO DELLA PORTA DI CASA CHE IL FATTORINO RIFÀ RESTAVANO NELL'ARCHIVIO PER SEMPRE.
 *
 * Ogni foto scelta va subito in `cod-proof/<fattorino>/<ordine>/` con un nome nuovo. Se il
 * fattorino la rifà o chiude il pannello, il file di prima non lo indica nessuna colonna
 * dell'ordine: la scadenza dei 90 giorni e la cancellazione dell'account non lo trovano. E se la
 * potatura dei 90 giorni non riusciva a togliere un file, le colonne erano già azzerate e nessuno
 * riprovava.
 *
 * Qui la notte VERA (la rotta process-deletions, col suo mondo finto): elenca il magazzino delle
 * prove, toglie le copie che nessun ordine indica più, e lascia stare le foto vive, le copie
 * troppo giovani e le cartelle di un ordine che non si riesce a rileggere.
 *
 * Secondo giro (collaudo del lotto 2): «viva» è una foto indicata da QUALSIASI colonna
 * dell'ordine che può puntare a cod-proof, compresa `delivery_signature_url`
 * (migrations/024:33), non solo dalle tre che si scrivono oggi.
 */

const mondo: { attuale: ReturnType<typeof fintoGiroNotturno> } = { attuale: fintoGiroNotturno() };

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.attuale.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async () => ({ ok: true, fileRimossi: 0, erroriFile: [] }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-13T04:00:00Z').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();

const RIDER = 'r1d3r000-0000-4000-8000-000000000001';
const ORDINE = '0d1e0000-0000-4000-8000-000000000001'; // consegnato ieri, la foto vera è la seconda
const VECCHIO = '0d1e0000-0000-4000-8000-000000000002'; // oltre 90 giorni: colonne già azzerate
const SPARITO = '0d1e0000-0000-4000-8000-000000000003'; // la cartella c'è, l'ordine non si rilegge
const FIRMATO = '0d1e0000-0000-4000-8000-000000000004'; // la prova sta solo in delivery_signature_url

function richiesta(url: string) {
  return new Request(url, { method: 'POST', headers: { authorization: 'Bearer segreto-dei-lavori' } }) as never;
}

const rimossiDalleProve = () =>
  mondo.attuale.diario.flatMap((v) => (v.op === 'file-rimossi' && v.secchio === 'cod-proof' ? v.percorsi : []));

function preparaIlMagazzino() {
  mondo.attuale = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      orders: [
        {
          id: ORDINE,
          cash_photo_url: `${RIDER}/${ORDINE}/contanti.jpg`,
          delivery_photo_url: `${RIDER}/${ORDINE}/porta-bis.jpg`,
          cash_signature_url: null,
        },
        // La potatura dei 90 giorni ha azzerato le colonne, ma lo storage aveva rifiutato la rimozione.
        { id: VECCHIO, cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null },
      ],
    },
    secchi: {
      'cod-proof': {
        '': [{ name: RIDER, id: null }],
        [RIDER]: [
          { name: ORDINE, id: null },
          { name: VECCHIO, id: null },
          { name: SPARITO, id: null },
        ],
        [`${RIDER}/${ORDINE}`]: [
          { name: 'contanti.jpg', id: 'f1', created_at: giorniFa(10) },
          // La prima foto della porta, rifatta subito dopo: nessuna colonna la indica.
          { name: 'porta.jpg', id: 'f2', created_at: giorniFa(10) },
          { name: 'porta-bis.jpg', id: 'f3', created_at: giorniFa(10) },
          // Caricata stanotte, mentre il fattorino conferma: troppo giovane per toccarla.
          { name: 'appena-caricata.jpg', id: 'f4', created_at: giorniFa(0.01) },
        ],
        [`${RIDER}/${VECCHIO}`]: [{ name: 'porta.jpg', id: 'f5', created_at: giorniFa(120) }],
        [`${RIDER}/${SPARITO}`]: [{ name: 'porta.jpg', id: 'f6', created_at: giorniFa(30) }],
      },
    },
  });
}

describe('R21-013 · le foto rifatte dal fattorino non restano per sempre', () => {
  const salvato = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    process.env.CRON_SECRET = 'segreto-dei-lavori';
    preparaIlMagazzino();
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.CRON_SECRET = salvato;
  });

  it('IL CASO CHE ROMPEVA — la notte toglie la foto della porta rifatta e quella che la potatura non aveva tolto', async () => {
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions'));
    const corpo = await res.json();
    expect(mondo.attuale.elenchi, 'la notte non guarda nemmeno il magazzino delle prove').toContain('cod-proof:');
    expect(rimossiDalleProve().sort()).toEqual([`${RIDER}/${ORDINE}/porta.jpg`, `${RIDER}/${VECCHIO}/porta.jpg`].sort());
    expect(corpo.retentionFallite ?? 0, 'il passo nuovo non deve far suonare la notte').toBe(0);
    expect(res.status).toBe(200);
  });

  it('le foto vive, quelle appena caricate e le cartelle di un ordine che non si rilegge restano', async () => {
    await POST(richiesta('http://localhost/api/cron/process-deletions'));
    const tolti = rimossiDalleProve();
    expect(tolti).not.toContain(`${RIDER}/${ORDINE}/contanti.jpg`);
    expect(tolti).not.toContain(`${RIDER}/${ORDINE}/porta-bis.jpg`);
    expect(tolti).not.toContain(`${RIDER}/${ORDINE}/appena-caricata.jpg`);
    expect(tolti).not.toContain(`${RIDER}/${SPARITO}/porta.jpg`);
  });

  it('se gli ordini non si leggono non si toglie niente dal magazzino delle prove, e la notte lo dice', async () => {
    mondo.attuale = fintoGiroNotturno({
      tabelle: { profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [] },
      errori: { orders: 'tempo scaduto' },
      secchi: {
        'cod-proof': {
          '': [{ name: RIDER, id: null }],
          [RIDER]: [{ name: ORDINE, id: null }],
          [`${RIDER}/${ORDINE}`]: [{ name: 'porta.jpg', id: 'f2', created_at: giorniFa(10) }],
        },
      },
    });
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions'));
    const corpo = await res.json();
    expect(rimossiDalleProve()).toEqual([]);
    expect(corpo.retentionFallite).toBeGreaterThan(0);
  });

  it('una foto indicata solo da delivery_signature_url è viva: la notte non la toglie', async () => {
    mondo.attuale = fintoGiroNotturno({
      tabelle: {
        profiles: [{ id: 'admin-1', role: 'admin' }],
        notifications: [],
        orders: [
          {
            id: FIRMATO,
            cash_photo_url: null,
            delivery_photo_url: null,
            cash_signature_url: null,
            delivery_signature_url: `${RIDER}/${FIRMATO}/firma.png`,
          },
        ],
      },
      secchi: {
        'cod-proof': {
          '': [{ name: RIDER, id: null }],
          [RIDER]: [{ name: FIRMATO, id: null }],
          [`${RIDER}/${FIRMATO}`]: [
            { name: 'firma.png', id: 'f7', created_at: giorniFa(10) },
            // Nella stessa cartella una copia che nessuna colonna indica: questa sì, se ne va.
            { name: 'firma-rifatta.png', id: 'f8', created_at: giorniFa(10) },
          ],
        },
      },
    });
    const res = await POST(richiesta('http://localhost/api/cron/process-deletions'));
    const tolti = rimossiDalleProve();
    expect(tolti, 'la notte toglie la firma che l’ordine indica in delivery_signature_url').not.toContain(
      `${RIDER}/${FIRMATO}/firma.png`,
    );
    expect(tolti).toEqual([`${RIDER}/${FIRMATO}/firma-rifatta.png`]);
    expect(res.status).toBe(200);
  });
});
