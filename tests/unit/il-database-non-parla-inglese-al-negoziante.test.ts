import { describe, it, expect, vi } from 'vitest';
import { friendlyError } from '@/lib/errors';

vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));

/**
 * IL MOTORE DEL DATABASE PARLAVA INGLESE AL NEGOZIANTE (radiografia del 3/9/2026).
 *
 * `friendlyError` e' il traduttore unico degli errori del sito: lo chiamano le pagine per decidere
 * cosa scrivere a schermo. In fondo aveva un ramo che, non avendo riconosciuto niente, ripuliva il
 * messaggio grezzo e lo mostrava tale e quale se era corto, su una riga sola e cominciava per
 * lettera. Quei tre indizi sono di FORMA, e i messaggi di Postgres hanno esattamente quella forma:
 * la rete di sicurezza si comportava da porta aperta.
 *
 * Cosa vedeva il negoziante di Piacenza: scriveva una descrizione un po' lunga, premeva Salva e
 * leggeva «value too long for type character varying». Non sapeva cosa aveva sbagliato ne' cosa
 * accorciare: chiamava noi, o lasciava perdere il prodotto. Vale per ogni salvataggio del pannello
 * venditore, non per una pagina sola.
 *
 * Questa prova ESEGUE il traduttore sui messaggi veri del motore e guarda cosa esce. E' rossa
 * finche' anche uno solo di quei messaggi arriva a schermo com'e'.
 *
 * ⚠️ Il secondo blocco e' la meta' che conta di piu': una rete piu' stretta e' un guadagno solo se
 * NON mangia le frasi italiane che le pagine mandano apposta all'utente. Se sparissero quelle,
 * questa correzione sarebbe peggiore del difetto.
 */

/** Le frasi che il motore scrive di suo, in inglese, senza un codice che le identifichi. */
const DAL_MOTORE = [
  'value too long for type character varying(120)',
  'invalid input syntax for type numeric: "12,50"',
  'invalid input value for enum order_status: "consegnato"',
  'canceling statement due to statement timeout',
  'null value in column "price" violates not-null constraint',
  'column products.prezzo does not exist',
  'relation "public.ordini" does not exist',
];

/** Le frasi che le NOSTRE rotte mandano apposta all'utente: devono arrivare intere. */
const NOSTRE = [
  'Pane Quotidiano è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.',
  'Il negozio ha già accettato l ordine, non puoi più annullarlo.',
  'Ordine già incassato in contanti: scrivi all assistenza per la restituzione.',
  'Ordine già annullato',
];

describe('quello che scrive il database non arriva a schermo com e', () => {
  for (const grezzo of DAL_MOTORE) {
    it(`«${grezzo.slice(0, 44)}…» non esce in inglese`, () => {
      const detto = friendlyError({ message: grezzo });
      // Nessun pezzo del messaggio del motore, e nemmeno il nome di una colonna o di una tabella.
      expect(detto, 'il testo del motore e uscito tale e quale').not.toContain(grezzo.slice(0, 20));
      expect(detto).not.toMatch(/character varying|invalid input|statement|constraint|relation|column/i);
      // E qualcosa di utile in italiano deve pur dirlo: il generico e' l'ultima spiaggia, non il vuoto.
      expect(detto.length, 'una frase vuota non aiuta nessuno').toBeGreaterThan(10);
    });
  }

  it('e i tre casi frequenti dicono anche il rimedio, non solo che e andata male', () => {
    expect(friendlyError({ message: 'value too long for type character varying(120)' })).toMatch(
      /accorcia/i,
    );
    expect(friendlyError({ message: 'invalid input syntax for type numeric: "12,50"' })).toMatch(
      /numeri e date/i,
    );
    expect(friendlyError({ message: 'canceling statement due to statement timeout' })).toMatch(
      /riprova/i,
    );
  });

  it('IL DIFETTO, RICREATO: con i soli tre indizi di forma quelle frasi passavano tutte', () => {
    // Il filtro di prima, riscritto qui tale e quale: corto, una riga sola, comincia per lettera.
    const passavaPrima = (m: string) =>
      m.length > 0 && m.length < 200 && !m.includes('\n') && /^[a-zA-ZÀ-ſ]/.test(m);
    expect(
      DAL_MOTORE.filter(passavaPrima),
      'se questa lista non e piena, la prova non sta misurando il difetto vero',
    ).toHaveLength(DAL_MOTORE.length);
  });
});

describe('le frasi scritte da noi per l utente passano ancora intere', () => {
  for (const nostra of NOSTRE) {
    it(`«${nostra.slice(0, 40)}…» arriva al cliente`, () => {
      const detto = friendlyError(new Error(nostra));
      expect(detto).toContain(nostra.slice(0, 24));
      expect(detto).not.toMatch(/Qualcosa non ha funzionato/);
    });
  }
});
