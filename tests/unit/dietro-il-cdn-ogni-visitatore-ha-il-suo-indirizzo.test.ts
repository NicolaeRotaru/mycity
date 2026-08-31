import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp } from '@/lib/rate-limit';

/**
 * DIETRO IL CDN OGNI VISITATORE DEVE AVERE IL SUO INDIRIZZO.
 *
 * 31/8/2026 (R018, ricaduta) — Il sito sta dietro Cloudflare (lo dichiara il
 * README). Con un CDN davanti la catena `x-forwarded-for` che arriva qui ha
 * piu' di un pezzo: l'indirizzo della persona, e poi i salti della nostra
 * idraulica interna che se lo passano.
 *
 * La riparazione del 27 agosto aveva smesso — giustamente — di credere sulla
 * parola a `cf-connecting-ip`, e aveva messo al suo posto un segreto di bordo.
 * Ma quel segreto e' spedito VUOTO, e il file di esempio dice a chiare lettere
 * che lasciarlo vuoto va bene. Con la configurazione che spediamo davvero,
 * quindi, l'indirizzo veniva letto in fondo alla catena — dove c'e' un pezzo
 * della nostra infrastruttura, uguale per tutti.
 *
 * Conseguenza per una persona vera: tutti i visitatori diventano lo stesso
 * indirizzo, il freno anti-abuso li conta insieme, e dopo poche centinaia di
 * visite il sito comincia a rispondere «troppe richieste» a gente che sta solo
 * guardando le vetrine. E' testualmente il danno che il commento del 22 agosto,
 * dieci righe sopra nella stessa funzione, dice di aver riparato.
 *
 * La regola giusta non e' credere a un'intestazione, ed e' l'unica che sta in
 * piedi da sola: la coda della catena e' idraulica nostra — indirizzi privati,
 * che dalla rete pubblica nessuno puo' avere — e va scartata. Il primo
 * indirizzo pubblico che si incontra venendo da destra e' quello che il nostro
 * bordo ha visto davvero: la persona, se davanti non c'e' nessuno; il CDN, se
 * il CDN c'e'. E quando quel salto e' un indirizzo di Cloudflare — quindi
 * quando a parlare e' davvero Cloudflare, non chi bussa all'origine — allora
 * `cf-connecting-ip` e' autentica e vale.
 */

const salvato = { ...process.env };
afterEach(() => { process.env = { ...salvato }; });

function richiesta(headers: Record<string, string>): Request {
  return new Request('https://mycity.test/api/prova', { headers });
}

/**
 * La catena come arriva davvero con un CDN davanti: a sinistra la persona,
 * poi i salti privati che se la passano dentro casa nostra.
 */
function dietroIlCdn(visitatore: string): Record<string, string> {
  return { 'x-forwarded-for': `${visitatore}, 172.16.0.1, 10.0.0.5` };
}

describe('dietro il CDN, con la configurazione spedita', () => {
  it('IL CASO CHE ROMPEVA — tre visitatori diversi non diventano lo stesso indirizzo', () => {
    delete process.env.EDGE_TRUST_SECRET; // e' il valore spedito: .env.example lo lascia vuoto

    const letti = [
      getClientIp(richiesta(dietroIlCdn('203.0.113.9'))),
      getClientIp(richiesta(dietroIlCdn('198.51.100.4'))),
      getClientIp(richiesta(dietroIlCdn('93.40.10.5'))),
    ];

    expect(
      new Set(letti).size,
      `tre persone diverse sono state lette come lo stesso indirizzo (${letti.join(' / ')}): il freno anti-abuso le conta insieme e le blocca tutte`,
    ).toBe(3);
    expect(letti).toEqual(['203.0.113.9', '198.51.100.4', '93.40.10.5']);
  });

  it('l ultimo salto e nostro, e non e nessuno: non finisce mai nel conto', () => {
    delete process.env.EDGE_TRUST_SECRET;
    expect(
      getClientIp(richiesta(dietroIlCdn('203.0.113.9'))),
      'nel conto delle richieste per indirizzo finisce un pezzo della nostra infrastruttura',
    ).not.toBe('10.0.0.5');
  });

  it('quando a parlare e davvero Cloudflare, la sua intestazione vale', () => {
    delete process.env.EDGE_TRUST_SECRET;
    // 172.68.1.1 e' dentro 172.64.0.0/13, una delle reti pubblicate da Cloudflare:
    // chi bussa dritto all'origine da casa sua non ha un indirizzo cosi'.
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '93.40.10.5',
      'x-forwarded-for': '93.40.10.5, 172.68.1.1',
    }));
    expect(ip).toBe('93.40.10.5');
  });
});

describe('il caso ostile resta chiuso: chi si scrive l intestazione non la fa franca', () => {
  it('chi bussa dritto all origine e si scrive cf-connecting-ip non diventa uno nuovo ogni volta', () => {
    delete process.env.EDGE_TRUST_SECRET;
    // Stessa persona, due richieste, due indirizzi inventati nell'intestazione
    // del CDN. Se contassero, nessun contatore arriverebbe mai al suo tetto.
    const a = getClientIp(richiesta({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '203.0.113.9' }));
    const b = getClientIp(richiesta({ 'cf-connecting-ip': '2.2.2.2', 'x-forwarded-for': '203.0.113.9' }));
    expect(a, 'chi bussa si e scelto l indirizzo: il freno non scattera mai').toBe(b);
    expect(a).toBe('203.0.113.9');
  });

  it('nemmeno mettendosi in coda dei salti privati per farci guardare piu a sinistra', () => {
    delete process.env.EDGE_TRUST_SECRET;
    // 6.6.6.6 se lo e' scritto il chiamante; 93.40.10.5 lo ha aggiunto il nostro
    // bordo vedendolo arrivare. In mezzo, salti privati messi apposta.
    const ip = getClientIp(richiesta({
      'x-forwarded-for': '6.6.6.6, 10.0.0.9, 93.40.10.5',
    }));
    expect(
      ip,
      'ha vinto il pezzo che si e scritto il chiamante invece di quello visto dal nostro bordo',
    ).toBe('93.40.10.5');
  });

  it('e nemmeno spacciandosi per Cloudflare con un indirizzo che non e di Cloudflare', () => {
    delete process.env.EDGE_TRUST_SECRET;
    const ip = getClientIp(richiesta({
      'cf-connecting-ip': '1.1.1.1',
      // 172.16.0.1 e' privato, 203.0.113.9 e' il vero chiamante: nessuno dei due
      // e' una rete di Cloudflare.
      'x-forwarded-for': '203.0.113.9, 172.16.0.1',
    }));
    expect(ip).toBe('203.0.113.9');
  });
});

/**
 * Un riconoscitore che capisce una sola forma scritta da' per «non nostro»
 * tutto quello che non sa leggere — e allora il salto interno torna a passare
 * per un visitatore, cioe' il difetto rientra dalla finestra. Qui si controlla
 * che le forme in cui un indirizzo interno si scrive davvero siano riconosciute
 * tutte, e che quelle che gli SOMIGLIANO senza esserlo non vengano scartate.
 */
describe('quali salti sono nostri e quali no', () => {
  const nostri: Array<[string, string]> = [
    ['10.0.0.5', 'la rete interna piu comune'],
    ['172.16.0.1', 'l altra rete interna classica'],
    ['192.168.1.1', 'una rete di casa'],
    ['127.0.0.1', 'il computer stesso'],
    ['169.254.10.1', 'un indirizzo che un cavo si e dato da solo'],
    ['::1', 'il computer stesso, scritto in IPv6'],
    ['fd00::1', 'una rete interna IPv6'],
    ['fe80::1234', 'un vicino di cavo IPv6'],
    ['::ffff:10.0.0.5', 'una rete interna travestita da IPv6'],
  ];

  it.each(nostri)('%s in coda alla catena non viene scambiato per il visitatore (%s)', (salto) => {
    delete process.env.EDGE_TRUST_SECRET;
    expect(
      getClientIp(richiesta({ 'x-forwarded-for': `203.0.113.9, ${salto}` })),
      `${salto} e un salto della nostra idraulica e finisce nel conto come se fosse una persona`,
    ).toBe('203.0.113.9');
  });

  const nonNostri: Array<[string, string]> = [
    ['172.32.0.1', 'somiglia a 172.16.0.0/12 ma e fuori: e internet'],
    ['100.64.7.9', 'e un abbonato dietro il CGNAT di un operatore, non un nostro salto'],
    ['11.0.0.1', 'somiglia a 10.0.0.0/8 ma e fuori'],
    ['2001:db8::1', 'un IPv6 pubblico'],
  ];

  it.each(nonNostri)('%s resta il visitatore: %s', (salto) => {
    delete process.env.EDGE_TRUST_SECRET;
    expect(
      getClientIp(richiesta({ 'x-forwarded-for': `6.6.6.6, ${salto}` })),
      `${salto} e stato scambiato per un salto nostro, e cosi si e finiti a leggere il pezzo che si scrive il chiamante`,
    ).toBe(salto);
  });

  it('se la catena e tutta di casa non si inventa niente: e lo sviluppo in locale', () => {
    delete process.env.EDGE_TRUST_SECRET;
    expect(getClientIp(richiesta({ 'x-forwarded-for': '127.0.0.1' }))).toBe('127.0.0.1');
  });
});
