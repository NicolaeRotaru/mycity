import { describe, it, expect } from 'vitest';

import { opzioniSentry, ripulisciEvento } from '@/lib/analytics/sentry-config';

/**
 * Prima di partire verso il registratore degli errori, il testo libero dell'evento (messaggio,
 * eccezione, briciole, extra, tags, contesti dell'applicazione) perde email, telefoni, indirizzi di
 * casa, IBAN e chiavi; i campi che dal nome portano un dato personale o una chiave si nascondono
 * interi. Quello che serve a capire l'errore resta.
 */

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.c2VncmV0b2RlbGxhY2hpYXZl';
const ORDINE = '0b4f1c1e-1111-4222-8333-944455556666';

const DATI_PERSONALI = [
  'mario.rossi@gmail.com',
  'giulia@esempio.it',
  '333 123 4567',
  '+39 347 765 4321',
  'Roma 12',
  'Emilia Pavese 45',
  'IT60X0542811101000000123456',
  'IT60 X054 2811 1010 0000 0123 456',
  JWT,
  'sk_live_51HxAbCdEfGh12345678',
  'whsec_AbCdEf1234567890',
  'pi_3Nx_secret_AbCdEf123456',
  'sk-ant-api03-AbCdEfGhIjKlMnOpQr',
  'segreto-nel-campo-token',
  'parola-della-password',
  'RSSMRA80A01G535X',
];

function eventoPieno(): any {
  return {
    message: `Ordine ${ORDINE} non partito: scrivi a mario.rossi@gmail.com o chiama 333 123 4567`,
    logentry: { message: 'Consegna in via Roma 12 non trovata', params: ['giulia@esempio.it'] },
    exception: {
      values: [
        {
          type: 'PostgrestError',
          value: `duplicate key: Key (email)=(giulia@esempio.it); IBAN IT60X0542811101000000123456; Authorization: Bearer ${JWT}`,
          stacktrace: { frames: [{ function: 'paga', vars: { chiave: 'sk_live_51HxAbCdEfGh12345678', clientSecret: 'pi_3Nx_secret_AbCdEf123456' } }] },
        },
      ],
    },
    breadcrumbs: [
      { category: 'console', message: 'telefono del cliente +39 347 765 4321', data: { arguments: ['corso Emilia Pavese 45, Piacenza'] } },
      { category: 'fetch', data: { url: '/api/orders/cod', method: 'POST', status_code: 500 } },
    ],
    extra: {
      ordine: ORDINE,
      nota: 'il cliente ha scritto IT60 X054 2811 1010 0000 0123 456 nel campo note',
      cliente: { id: 'u-1', email: 'mario.rossi@gmail.com', codiceFiscale: 'RSSMRA80A01G535X', accessToken: 'segreto-nel-campo-token' },
      password: 'parola-della-password',
      webhook: 'whsec_AbCdEf1234567890',
      ai: 'chiave sk-ant-api03-AbCdEfGhIjKlMnOpQr scaduta',
    },
    tags: { area: 'cassa', recapito: 'giulia@esempio.it' },
    contexts: {
      os: { name: 'iOS', version: '17.0.3' },
      pagamento: { delivery_address: 'via Roma 12', esito: 'rifiutato' },
    },
    user: { id: 'u-1', email: 'mario.rossi@gmail.com', ip_address: '1.2.3.4' },
  };
}

describe('il testo libero dell\'evento perde i dati personali e le chiavi', () => {
  it('nessuno dei dati personali o delle chiavi resta nell\'evento', () => {
    const pulito = JSON.stringify(ripulisciEvento(eventoPieno()));
    for (const dato of DATI_PERSONALI) expect(pulito, dato).not.toContain(dato);
  });

  it('vale anche per il registratore del browser (opzioniSentry)', () => {
    const pulito = JSON.stringify(opzioniSentry().beforeSend(eventoPieno()));
    for (const dato of DATI_PERSONALI) expect(pulito, dato).not.toContain(dato);
  });

  it('quello che serve a capire l\'errore resta', () => {
    const e = ripulisciEvento(eventoPieno());
    expect(e.message).toContain(`Ordine ${ORDINE} non partito`);
    expect(e.exception.values[0].type).toBe('PostgrestError');
    expect(e.exception.values[0].value).toContain('duplicate key');
    expect(e.extra.ordine).toBe(ORDINE);
    expect(e.extra.cliente.id).toBe('u-1');
    expect(e.tags.area).toBe('cassa');
    expect(e.contexts.os).toEqual({ name: 'iOS', version: '17.0.3' });
    expect(e.contexts.pagamento.esito).toBe('rifiutato');
    expect(e.breadcrumbs[1].data).toEqual({ url: '/api/orders/cod', method: 'POST', status_code: 500 });
    expect(e.user).toEqual({ id: 'u-1' });
  });

  it('una struttura che non si lascia riscrivere non fa partire il testo libero', () => {
    const e = eventoPieno();
    e.extra = Object.freeze({ nota: 'mario.rossi@gmail.com' });
    const pulito = JSON.stringify(ripulisciEvento(e));
    expect(pulito).not.toContain('mario.rossi@gmail.com');
  });
});
