import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analisiDaSalvare, analisiPerChiNonHaPagato, analisiPerLaFascia } from '@/lib/agenzia/rapporto';
import { linkGoogleMaps } from '@/lib/indirizzi-pubblici';

/**
 * IL RAPPORTO DOPO LA REVISIONE DI SICUREZZA (26/11/2026, mycity#336, testa f2f0170).
 * Ogni prova è rossa sulla testa rivista e verde dopo la correzione.
 */

const RADICE = path.resolve(__dirname, '../..');
const ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const LETTO = '2026-11-26T09:00:00Z';

/** Una riga come l'avrebbe salvata un n8n fuori contratto, o una riga di prima della pulizia. */
const SPORCA = {
  tipo_di_locale: '4,6 stelle su Google',
  pubblico: 'Famiglie del quartiere',
  punti_di_forza: ['Le brioche fatte in casa', 'Su Google ha 412 recensioni'],
  rapporto: { parti: { zona: {} } },
  google: { voto: 4.6 },
  business: {
    voto_google: 4.6,
    recensioni_clienti: [{ autore: 'Mario Rossi', testo: 'Ottimo' }],
    situazione: [{ testo: 'Bar in centro da dieci anni', fonte: 'https://x.it', autore: 'Mario Rossi' }],
    reputazione_temi: [{ tema: 'il caffè', tono: 'positivo', quante: 5, fonte: 'javascript:alert(1)' }, { tema: 'i dolci', tono: 'positivo', quante: 5, fonte: 'https://dataforseo.com/' }],
    parti: { situazione: 1 },
  },
  giudizio_sito: { livello: 'medio', google_rating: 4.6, nota: 'Sito lento' },
  fatti: {
    instagram: { stato: 'letto', fonte: 'https://x.it', fonte_nome: 'Instagram', letto_il: LETTO, dati: { follower: 100, commenti: [{ utente: 'mario.rossi', author: 'Mario', testo: 'bello' }] } },
  },
};

describe('3 · prima di salvare: lista bianca chiave per chiave', () => {
  const salvata = analisiDaSalvare(SPORCA) as Record<string, unknown>;
  const testo = JSON.stringify(salvata);

  it('niente voti né recensioni di Google, né autori o utenti, da nessuna parte', () => {
    expect(testo).not.toMatch(/voto_google|recensioni_clienti|google_rating|Mario|mario\.rossi|412|4,6|commenti|utente|author/);
  });

  it('le chiavi conosciute restano: le frasi delle sezioni, il giudizio del sito senza voti, i follower', () => {
    expect(testo).toContain('Bar in centro da dieci anni');
    expect(testo).toContain('Le brioche fatte in casa');
    expect(testo).toContain('Famiglie del quartiere');
    expect((salvata.giudizio_sito as Record<string, unknown>)).toEqual({ livello: 'medio', nota: 'Sito lento' });
    expect(testo).toContain('"follower":100');
  });

  it('un tema della reputazione con una fonte che non è https non si salva', () => {
    const temi = (salvata.business as Record<string, Array<{ tema: string }>>).reputazione_temi;
    expect(temi.map((t) => t.tema)).toEqual(['i dolci']);
  });
});

describe('3 e 4 · quello che arriva al browser è ripulito anche da una riga vecchia', () => {
  it('prima del pagamento: niente voti, autori, vecchia bozza, mappa delle parti', () => {
    const t = JSON.stringify(analisiPerChiNonHaPagato(SPORCA));
    expect(t).not.toMatch(/voto_google|recensioni_clienti|google_rating|Mario|"rapporto"|"google"|"parti"|4,6/);
  });

  it('dopo il pagamento, anche per un Base: lo stesso, più solo le parti della fascia', () => {
    const t = JSON.stringify(analisiPerLaFascia(SPORCA, 'base'));
    expect(t).not.toMatch(/voto_google|recensioni_clienti|google_rating|Mario|"rapporto"|"parti"|4,6|commenti/);
  });
});

describe('1 · «Scarica i miei dati» non manda il rapporto intero', () => {
  it('l’export legge la scheda dalla stessa strada della pagina del negozio, non con select(*)', () => {
    const src = readFileSync(path.join(RADICE, 'app/api/account/export/route.ts'), 'utf8');
    expect(src).not.toMatch(/from\('schede_clienti'\)\.select\('\*'\)/);
    expect(src).toContain('schedaPerIlNegozio');
  });
});

describe('5 · il link di Google Maps solo sui domini veri di Google', () => {
  it('domini finti no, domini veri sì', () => {
    expect(linkGoogleMaps('https://google.qzx.me/maps/place/Bar')).toBeNull();
    expect(linkGoogleMaps('https://maps.google.ab.cd/?cid=123')).toBeNull();
    expect(linkGoogleMaps('https://www.google.com/maps/place/Bar')).not.toBeNull();
    expect(linkGoogleMaps('https://www.google.it/maps/place/Bar')).not.toBeNull();
    expect(linkGoogleMaps('https://maps.google.it/?cid=123')).not.toBeNull();
    expect(linkGoogleMaps('https://maps.app.goo.gl/AbC123')).not.toBeNull();
  });
});

void ID;
