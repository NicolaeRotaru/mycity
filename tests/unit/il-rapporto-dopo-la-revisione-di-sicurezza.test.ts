import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analisiDaSalvare, analisiPerChiNonHaPagato, analisiPerLaFascia, campiDaSalvare, leggiRapporto } from '@/lib/agenzia/rapporto';
import { leggiSchedaSalvata, type SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import { leggiGiudizioSito } from '@/lib/agenzia/offerta-su-misura';
import { linkGoogleMaps } from '@/lib/indirizzi-pubblici';
import { schedaComeLaVedeIlNegozio } from '@/lib/agenzia/scheda-del-negozio';

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
  it('l’export legge la scheda con le regole della pagina del negozio, non con select(*) e basta', () => {
    const src = readFileSync(path.join(RADICE, 'app/api/account/export/route.ts'), 'utf8');
    expect(src).not.toMatch(/from\('schede_clienti'\)\.select\('\*'\)/);
    expect(src).toContain('schedaComeLaVedeIlNegozio');
  });

  it('le regole: chi non ha pagato non ha il rapporto, il Base non ha le parti escluse', () => {
    const grezza = { tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: { fatti: { ricerche: { stato: 'letto', fonte: 'https://dataforseo.com/', fonte_nome: 'DataForSEO', letto_il: LETTO, dati: { parole: [] } } }, business: { piano_30_giorni: [{ settimana: 1, azione: 'x', fonte: 'https://x.it' }] } } };
    const inProva = schedaComeLaVedeIlNegozio(grezza, { visibileSenzaAbbonamento: false, abbonamenti: [] })!;
    // In prova resta l'assaggio (le ricerche ne fanno parte), non le sezioni del rapporto.
    expect(JSON.stringify(inProva.analisi)).not.toContain('piano_30_giorni');
    const base = schedaComeLaVedeIlNegozio(grezza, { visibileSenzaAbbonamento: false, abbonamenti: [{ fascia: 'base', stato: 'active' }] })!;
    expect(JSON.stringify(base.analisi)).not.toContain('ricerche');
    expect(JSON.stringify(base.analisi)).toContain('piano_30_giorni');
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

describe('dal terzo collaudo', () => {
  it('1 · le sezioni nuove dell’AD: fonti solo https e non Google, testi senza voti né nomi, prima di salvare', () => {
    const salvata = analisiDaSalvare({ business: {
      confronto_concorrenti: [
        { nome: 'Bar A', differenza: 'Ha 4,8 su Google con 900 recensioni', meglio: 'Mario Rossi risponde a ogni recensione', fonte: 'https://www.openstreetmap.org/node/1', fonte_canali: 'javascript:alert(1)' },
        { nome: 'Bar B', differenza: 'apre prima', fonte: 'https://www.google.com/maps/place/Bar+B' },
      ],
      piano_30_giorni: [{ settimana: 1, azione: 'Foto della vetrina', fonte: 'http://tripadvisor.it/x' }],
    } }) as { business: Record<string, Array<Record<string, unknown>>> };
    expect(salvata.business.confronto_concorrenti).toEqual([{ nome: 'Bar A', differenza: null, meglio: null, fonte: 'https://www.openstreetmap.org/node/1', fonte_canali: null }]);
    expect(salvata.business.piano_30_giorni).toEqual([]);
  });

  it('2 · un campo con un voto di Google nel valore, o con una fonte Google mascherata, non si salva', () => {
    const campi = campiDaSalvare({
      valutazione: { valore: '4,6 su 5 su Google, 230 recensioni', stato: 'da_confermare', fonte: 'https://www.paginegialle.it/x' },
      foto: { valore: 'x', stato: 'foto', fonte: 'https://lh5.googleusercontent.com/abc' },
      api: { valore: 'x', stato: 'da_confermare', fonte: 'https://maps.googleapis.com/maps/api/place/x' },
      orari: { valore: 'Lun-Sab 7-19', stato: 'da_confermare', fonte: 'https://x@www.google.com/maps/place/y' },
      indirizzo: { valore: 'Via Roma 1', stato: 'confermato', fonte: 'https://www.bar.it' },
    });
    expect(Object.keys(campi)).toEqual(['indirizzo']);
  });

  it('3 e 4 · note, migliorie e liste legittime restano anche se dicono un anno e Google', () => {
    const s = leggiSchedaSalvata({ tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: {
      giudizio_sito: { livello: 'pregio', migliorie: 'Rifare la home del 2016 e aggiungere la mappa di Google', nota: 'Sito del 2015, senza mappa di Google Maps' },
      punti_di_forza: ['Aperto dal 1985, risponde a tutte le recensioni'],
      cosa_chiedere_al_titolare: ['Hai 2 sedi? Chi risponde alle recensioni?'],
      idee_contenuti: ['3 post al mese con le stelle di Natale in vetrina'],
    } }) as SchedaCliente;
    const g = leggiGiudizioSito((s.analisi as Record<string, unknown>).giudizio_sito);
    expect(g?.nota).toBe('Sito del 2015, senza mappa di Google Maps');
    expect(g?.migliorie).toBeTruthy();
    expect(s.analisi?.punti_di_forza).toHaveLength(1);
    expect(s.analisi?.cosa_chiedere_al_titolare).toHaveLength(1);
    expect(s.analisi?.idee_contenuti).toHaveLength(1);
  });

  it('5 · un nome di persona nella proposta del piano non si mostra', () => {
    const s = { tipo: 'scheda-cliente', id_attivita: ID, campi: {}, analisi: { business_fatta_il: LETTO, business: { piano_30_giorni: [{ settimana: 1, azione: 'Fotografare le brioche al mattino', proposta: 'servizio foto con Giulia Bianchi in negozio', fonte: 'https://x.it' }] } } } as unknown as SchedaCliente;
    expect(JSON.stringify(leggiRapporto(s, new Date('2026-11-26T14:00:00Z')))).not.toContain('Giulia');
  });
});

void ID;
