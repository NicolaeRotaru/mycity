import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import ShippingPage, { metadata as metadatiSpedizioni } from '@/app/shipping/page';
import { metadata as metadatiVicinoATe } from '@/app/near/layout';
import {
  PLATFORM_DELIVERY_FEE_CENTS,
  RAGGIO_CONSEGNA_KM,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
} from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { avvisoNessunNegozioVicino, NEGOZIO_CHIUSO_COSA_SUCCEDE } from '@/lib/promesse-pubbliche';

/**
 * 27/10/2026 (quarto giro) — LE PROMESSE DELLA CONSEGNA CAMBIANO SOLO DI PROPOSITO.
 *
 * Le prove del terzo giro cercavano parole: «gratis», «preventivo», «48 ore», «domani», «rapida»,
 * «aumenta». Il collaudo ha trovato per ognuna un modo di dire la stessa cosa con altre parole
 * («la consegna è a carico nostro», «oltre il confine ci accordiamo al telefono», «hai tempo fino a
 * domani per segnalarlo», «consegna veloce», «allarga il raggio») e tutto restava verde. Una lista
 * di parole proibite non finisce mai.
 *
 * Qui si fa il contrario: si tiene fermo il testo che la persona legge, frase per frase, come è
 * stato riletto contro le regole della cassa il 27/10 (3 euro per negozio, nessuna soglia, nessun
 * costo a chilometro, confine di 10 km e il caso in cui la cassa non lo misura, a negozio chiuso si
 * prenota per domani). Le cifre arrivano dalle costanti: le controllano le altre prove.
 *
 * SE QUESTA PROVA DIVENTA ROSSA perché hai cambiato una frase: rileggi la frase nuova contro quello
 * che fa la cassa, e solo allora aggiorna il testo qui sotto. Diventare rossa a ogni cambio è il suo
 * mestiere: sono promesse fatte a chi compra.
 *
 * 27/10/2026 (quinto giro) — ANCHE QUELLO CHE LEGGE GOOGLE. Il collaudo ha riscritto la descrizione
 * della pagina Spedizioni, quella che compare sotto il link nei risultati di ricerca e nelle
 * condivisioni: «Consegna a costo zero entro due giorni; fuori città ti facciamo un prezzo su misura».
 * Tre promesse false in una riga, e tutto restava verde: si tenevano ferme solo le frasi della pagina.
 * Ora la scheda per Google è tenuta ferma campo per campo, intera: anche un campo aggiunto si vede.
 */

const TRE_EURO = formatPrice(PLATFORM_DELIVERY_FEE_CENTS / 100);
// 29/10/2026 22:21 — una consegna sola per il carrello: l'euro in più vale per negozio in più, spesa piccola e veloce.
const UN_EURO = formatPrice(SUPPLEMENTO_CONSEGNA_CENTS / 100);
const DIECI_EURO = formatPrice(SPESA_SENZA_SUPPLEMENTO_CENTS / 100);
const KM = RAGGIO_CONSEGNA_KM;

/** Il testo di un pezzo di HTML, con le entità sciolte. */
function testoDi(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ');
}

/** Le frasi della pagina come le legge la persona: un blocco per paragrafo, voce d'elenco o titolo. */
function frasiDi(html: string): string[] {
  return html
    .split(/<\/(?:p|li|div|h[1-6])>|<br\s*\/?>/i)
    .map((b) => testoDi(b).trim())
    .filter(Boolean);
}

/** Il codice senza i commenti: le spiegazioni per chi programma non le legge il cliente. */
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NEGOZIO_CHIUSO =
  'Se il negozio è chiuso puoi prenotare per domani, scegliendo una fascia oraria in cassa: la consegna subito, invece, parte solo negli orari di apertura.';

const PAGINA_SPEDIZIONI = [
  'Spedizioni e consegne',
  'Tempi, costi e opzioni per ricevere il tuo ordine.',
  // 29/10/2026 — riletta con la regola firmata (registro dei fatti, consegna.promessa): 3 € con la
  // fascia, 4 € sotto i 10 € o con la veloce. Via «qualunque sia la spesa»: 8 € di merce pagano 4 €.
  `Consegna da ${TRE_EURO}`,
  'Una sola per tutto il carrello',
  'Consegna in 30-60 min',
  'Nei comuni serviti, negli orari di apertura del negozio',
  `Fino a ${KM} km`,
  "dal negozio, in linea d'aria",
  'Tempi di consegna',
  'Consegniamo in 30-60 min dalla conferma del venditore. È la nostra promessa: il negozio è nella tua città, il rider fa un percorso breve.',
  'Il tempo parte da quando il negozio conferma l’ordine, non da quando lo invii',
  'Vale negli orari di apertura del negozio che hai scelto',
  NEGOZIO_CHIUSO,
  'Quanto costa la consegna',
  // Lo spazio prima del punto è il grassetto della tariffa che `testoDi` scioglie in uno spazio.
  `Paghi solo la consegna, per ogni negozio da cui ordini: ${TRE_EURO} una volta sola per tutto il carrello, all’ora che scegli in cassa; ${UN_EURO} in più per ogni negozio in più e ${UN_EURO} in più per ogni negozio dove spendi meno di ${DIECI_EURO}; la consegna veloce ${UN_EURO} in più, compresa se un negozio è sotto i ${DIECI_EURO} . Non c'è un costo a chilometro.`,
  'Se ordini da due negozi paghi due consegne: ogni negozio ti porta la sua spesa.',
  'Il totale lo vedi sempre in cassa, prima di confermare l’ordine.',
  'Tracciamento',
  'Da "I miei ordini" vedi in tempo reale:',
  'In attesa di conferma',
  'In preparazione presso il venditore',
  'Pronto per il ritiro / la consegna',
  'In consegna (con nome del rider)',
  'Consegnato',
  'Aree servite',
  // 28/10/2026 — riletta col confine a 5 km: via «e dintorni», che prometteva Podenzano, Rottofreno
  // e Gossolengo. Lo spazio prima della virgola è il grassetto di «Piacenza» che `testoDi` scioglie
  // in uno spazio, come in «vai ai contatti .» più sotto: sullo schermo non c'è.
  `Consegniamo a Piacenza , fino a ${KM} km dal negozio in linea d'aria. Quando scrivi il tuo indirizzo, in cassa misuriamo la distanza e ti diciamo subito se ci arriviamo. Se l'indirizzo non si trova sulla mappa, la cassa non riesce a misurarla e l'ordine passa senza questo controllo.`,
  'Problemi con la consegna?',
  'Se la consegna è in ritardo, il pacco è danneggiato o non è arrivato, scrivici appena puoi: vai ai contatti . Per i difetti dei prodotti vale comunque la garanzia legale di 24 mesi.',
];

describe('la pagina Spedizioni dice, frase per frase, quello che fa la cassa', () => {
  const frasi = frasiDi(renderToStaticMarkup(<ShippingPage />));

  it('nessuna frase aggiunta, tolta o riscritta senza rileggerla contro la cassa', () => {
    const nuove = frasi.filter((f) => !PAGINA_SPEDIZIONI.includes(f));
    const sparite = PAGINA_SPEDIZIONI.filter((f) => !frasi.includes(f));
    expect({ nuove, sparite }, 'la pagina Spedizioni è cambiata: rileggi le frasi contro la cassa').toEqual({
      nuove: [],
      sparite: [],
    });
    expect(frasi).toEqual(PAGINA_SPEDIZIONI);
  });

  it('IL CASO DEL COLLAUDO — la scheda per Google e per le condivisioni è quella riletta, campo per campo', () => {
    expect(metadatiSpedizioni, 'la scheda della pagina Spedizioni per Google è cambiata: rileggila contro la cassa').toEqual({
      title: 'Spedizioni e consegne · MyCity',
      description: 'Tempi, costi e modalità di consegna su MyCity.',
      alternates: { canonical: '/shipping' },
      openGraph: {
        title: 'Spedizioni e consegne · MyCity',
        description: 'Tempi, costi e modalità di consegna dei negozi di Piacenza su MyCity.',
        type: 'website',
        locale: 'it_IT',
        siteName: 'MyCity',
        url: '/shipping',
      },
    });
  });

  it('a negozio chiuso la frase pubblica è quella riletta: si prenota per domani', () => {
    expect(NEGOZIO_CHIUSO_COSA_SUCCEDE).toBe(NEGOZIO_CHIUSO);
  });
});

describe('«Vicino a te» dice il confine com’è, ovunque lo dica', () => {
  it('la descrizione per Google e per le condivisioni è quella riletta: confine sì, «rapida» no', () => {
    expect({
      title: metadatiVicinoATe.title,
      description: metadatiVicinoATe.description,
      ogTitle: metadatiVicinoATe.openGraph?.title,
      ogDescription: metadatiVicinoATe.openGraph?.description,
      twitterTitle: metadatiVicinoATe.twitter?.title,
      twitterDescription: metadatiVicinoATe.twitter?.description,
    }).toEqual({
      title: 'Vicino a te — Negozi e prodotti a Piacenza · MyCity',
      description: `Trova negozi e prodotti vicino a te a Piacenza. Scopri cosa puoi comprare nella tua zona, con consegna fino a ${KM} km dal negozio.`,
      ogTitle: 'Vicino a te · MyCity Piacenza',
      ogDescription: `Negozi e prodotti vicino a te a Piacenza, con consegna fino a ${KM} km dal negozio.`,
      twitterTitle: 'Vicino a te · MyCity Piacenza',
      twitterDescription: 'Negozi e prodotti vicino a te a Piacenza.',
    });
  });

  it('al confine la lista vuota dice che oltre non si arriva, e non invita ad allargare', () => {
    expect(avvisoNessunNegozioVicino(KM)).toBe(
      `Nessun negozio entro ${KM} km. Per ora consegniamo fino a ${KM} km dal negozio, e oltre non arriviamo.`,
    );
    // Sotto il confine il cursore può ancora salire: lì l'invito è vero.
    expect(avvisoNessunNegozioVicino(3)).toBe('Nessun negozio entro 3 km. Aumenta il raggio per vederne di più.');
  });

  it('la pagina non scrive un suo invito ad allargare la ricerca: la frase la decide l’avviso', () => {
    const pagina = senzaCommenti(readFileSync(join(process.cwd(), 'app/near/page.tsx'), 'utf8'));
    expect(pagina).toContain('avvisoNessunNegozioVicino(radiusKm)');
    const inviti = pagina.match(/aument|allarg|ampli|estend|più (?:lontan|ampi)|raggio (?:più )?(?:ampio|grande|maggiore)/gi) ?? [];
    expect(inviti, 'la pagina «Vicino a te» invita da sola ad allargare il raggio').toEqual([]);
  });
});

describe('admin dice il confine com’è, anche quando la cassa non lo misura', () => {
  it('la riga «Confine della consegna» è quella riletta: dice il caso senza posizione', () => {
    const admin = readFileSync(join(process.cwd(), 'app/admin/delivery/page.tsx'), 'utf8');
    const righe = [...admin.matchAll(/title="Confine della consegna"\s*desc="([^"]*)"/g)].map((m) => m[1]);
    expect(righe).toEqual([
      "In linea d'aria dal negozio: oltre, la cassa rifiuta l'indirizzo. Se il negozio non ha la posizione sulla vetrina o l'indirizzo non si trova sulla mappa, la cassa non può misurare e lo accetta: la distanza va guardata a mano",
    ]);
  });
});
