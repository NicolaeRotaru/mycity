import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { chiaveDellaPaginaVista, __dimenticaLeRicerche } from '@/lib/analytics/tracciamento';

/**
 * «DA QUI ESCE L'IMPRONTA, NON IL TESTO» — E INVECE USCIVA ANCHE IL TESTO.
 *
 * Nella casella di ricerca la gente scrive la propria email per ritrovare un ordine, il numero di
 * telefono, il nome di un'altra persona. Quel testo finiva nell'indirizzo della pagina e da lì
 * partiva verso Google. Per non spedirlo si era messo al suo posto un numero calcolato dal testo —
 * un'impronta — e sopra ci si era scritto che così il testo non usciva più.
 *
 * Non era vero, ed era peggio di non aver fatto niente: una frase del genere spegne il sospetto di
 * chi passa di lì il mese dopo. Un'impronta senza segreto si rovescia provando: si prende un elenco
 * di valori plausibili, si calcola l'impronta di ognuno, si guarda quale coincide. Qui sotto
 * l'elenco è di 1440 indirizzi email costruiti a tavolino, e ci mette meno di un millesimo di
 * secondo.
 *
 * ── Cosa pretende questa prova ────────────────────────────────────────────────────────────────
 * Che quello che esce NON dipenda dal contenuto. Non «che sia difficile da rovesciare»: che non ci
 * sia niente da rovesciare. Se un domani qualcuno rimette un valore calcolato dal testo — impronta,
 * hash, cifratura fatta in casa — la prima prova qui sotto torna rossa, perché mille contenuti
 * diversi ricominceranno a dare mille chiavi diverse.
 *
 * ⚠️ Il conto del posto in fila vive nella scheda del browser. Qui lo si azzera fra una prova e
 * l'altra con `__dimenticaLeRicerche`: è il modo per far finta di essere una scheda nuova, cioè
 * quello che è l'attaccante — che nella scheda della persona non entra.
 */

const NOMI = ['mario', 'giulia', 'luca', 'anna', 'marco', 'chiara', 'paolo', 'elena', 'andrea', 'sara'];
const COGNOMI = ['rossi', 'bianchi', 'ferrari', 'russo', 'esposito', 'romano', 'colombo', 'ricci'];
const DOMINI = ['gmail.com', 'libero.it', 'hotmail.it', 'yahoo.it', 'outlook.it', 'virgilio.it'];

/** 1440 indirizzi che una persona può davvero avere. È l'elenco con cui si rovescia un'impronta. */
function dizionarioDiEmailVere(): string[] {
  const elenco: string[] = [];
  for (const nome of NOMI) {
    for (const cognome of COGNOMI) {
      for (const dominio of DOMINI) {
        elenco.push(`${nome}.${cognome}@${dominio}`, `${nome}${cognome}@${dominio}`, `${nome}_${cognome}@${dominio}`);
      }
    }
  }
  return elenco;
}

/** Quello che la persona ha scritto nella casella, e che nessuno deve poter ricavare. */
const CERCATO_DALLA_PERSONA = 'mario.rossi@gmail.com';

function chiaveDiUnaRicerca(testo: string): string {
  return chiaveDellaPaginaVista('/search', new URLSearchParams(`q=${encodeURIComponent(testo)}`));
}

beforeEach(() => __dimenticaLeRicerche());

describe('quello che parte verso Google non si rovescia con un dizionario', () => {
  it('1440 email vere provate una per una: nessuna dice qual era quella giusta', () => {
    // La scheda della persona: cerca la sua email, e la chiave parte verso Google.
    const chiaveIntercettata = chiaveDiUnaRicerca(CERCATO_DALLA_PERSONA);

    // L'attaccante non è dentro quella scheda: ogni tentativo parte da una scheda pulita.
    const chiaviProvate = new Set(
      dizionarioDiEmailVere().map((candidato) => {
        __dimenticaLeRicerche();
        return chiaveDiUnaRicerca(candidato);
      }),
    );

    expect(
      chiaviProvate.size,
      'la chiave cambia col contenuto: un elenco di valori plausibili la rovescia',
    ).toBe(1);
    expect(
      chiaviProvate.has(chiaveIntercettata),
      'tutti i candidati danno la stessa chiave della persona: nessuno di loro la identifica',
    ).toBe(true);
  });

  it('due contenuti diversi, nella stessa posizione, danno la stessa identica chiave', () => {
    __dimenticaLeRicerche();
    const email = chiaveDiUnaRicerca(CERCATO_DALLA_PERSONA);
    __dimenticaLeRicerche();
    const pane = chiaveDiUnaRicerca('pane');
    expect(email, 'la chiave dipende ancora da quello che la persona ha scritto').toBe(pane);
  });

  it('e non esce niente di leggibile, per nessuna delle cose che la gente scrive davvero', () => {
    for (const scritto of [
      'mario.rossi@gmail.com',
      'ordine di giulia bianchi',
      'consegna al 3331234567',
      'via Roma 14 Piacenza',
    ]) {
      const chiave = chiaveDiUnaRicerca(scritto);
      const inChiaro = decodeURIComponent(chiave.replace(/\+/g, ' ')).toLowerCase();
      for (const pezzo of scritto.toLowerCase().split(/[\s@]+/)) {
        if (pezzo.length < 4) continue;
        expect(inChiaro, `«${pezzo}» esce ancora dalla porta di Google`).not.toContain(pezzo);
      }
    }
  });
});

describe('e i conti continuano a tornare: distinguere si deve ancora', () => {
  it('due ricerche diverse nella stessa scheda restano due pagine viste diverse', () => {
    expect(chiaveDiUnaRicerca('pane')).not.toBe(chiaveDiUnaRicerca('vino'));
  });

  it('la stessa ricerca ripetuta resta la stessa pagina', () => {
    expect(chiaveDiUnaRicerca('pane')).toBe(chiaveDiUnaRicerca('pane'));
  });

  it('sette tocchi ai filtri restano una pagina sola', () => {
    const chiavi = [
      'q=pane',
      'q=pane&cat=gastronomia',
      'q=pane&cat=gastronomia&min=2&max=20',
      'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc&aperti=1',
    ].map((coda) => chiaveDellaPaginaVista('/search', new URLSearchParams(coda)));
    expect(new Set(chiavi).size).toBe(1);
  });

  it('la strada resta: senza, non si sa più quali pagine si visitano', () => {
    expect(chiaveDellaPaginaVista('/store/12/panificio-garetti', null)).toBe('/store/12/panificio-garetti');
  });
});

describe('il file non torna a calcolare un numero dal testo', () => {
  it('niente hash veloce dentro il tracciamento', () => {
    const src = readFileSync('lib/analytics/tracciamento.ts', 'utf8');
    // FNV-1a e i suoi parenti: la moltiplicazione a 32 bit e i numeri primi che li identificano.
    expect(src, 'è tornato un valore calcolato dal testo: si rovescia con un dizionario')
      .not.toMatch(/Math\.imul|0x811c9dc5|0x01000193|createHash/);
  });
});
