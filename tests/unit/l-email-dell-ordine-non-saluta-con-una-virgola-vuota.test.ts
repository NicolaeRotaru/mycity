import { describe, it, expect } from 'vitest';
import { orderConfirmedBuyerTemplate, orderDeliveredTemplate } from '@/lib/email/templates';

/**
 * 6/9/2026 — «CIAO ,» ERA LA PRIMA COSA CHE IL CLIENTE RICEVEVA DOPO AVER PAGATO.
 *
 * Le due email che seguono un ordine — «abbiamo ricevuto il tuo ordine» e «il
 * tuo ordine è stato consegnato» — aprivano con `Ciao ${nome ?? ''},`. Quando
 * sul profilo il nome non c'è (registrazione senza nome, accesso con Google che
 * non lo passa, profilo vecchio) la frase usciva così: «Ciao , abbiamo ricevuto
 * il tuo ordine da Pane Quotidiano.»
 *
 * Succede su tutte e due le strade di pagamento — contanti alla consegna e
 * carta — cioè su ogni ordine del sito. È il momento in cui chi ha appena
 * pagato 24,50 € decide se siamo un negozio serio o un sito raffazzonato.
 *
 * La prova COSTRUISCE i messaggi veri e guarda il testo che esce, non il
 * sorgente: se qualcuno rimette il nome dentro una frase già scritta, con la
 * stringa vuota come ripiego, questa diventa rossa.
 *
 * ⚪ Non apro Gmail: controllo l'HTML che parte da noi, non come lo impagina
 * ogni programma di posta.
 */

const ORDINE = { orderId: 'a1b2c3d4-0000-0000-0000-000000000000', total: 24.5 };
const NOMI_MANCANTI: Array<string | null | undefined> = [null, undefined, '', '   '];

function messaggi(nome: string | null | undefined) {
  return [
    { quale: 'la conferma dell\'ordine', ...orderConfirmedBuyerTemplate({ ...ORDINE, name: nome, storeName: 'Pane Quotidiano' }) },
    { quale: 'l\'email di consegna', ...orderDeliveredTemplate({ ...ORDINE, name: nome }) },
  ];
}

describe('le email dell\'ordine quando il nome del cliente non c\'è', () => {
  for (const nome of NOMI_MANCANTI) {
    it(`non salutano con una virgola sospesa (nome: ${JSON.stringify(nome)})`, () => {
      for (const m of messaggi(nome)) {
        expect(
          m.html,
          `${m.quale} apre con «Ciao ,»: è la prima cosa che il cliente legge dopo aver pagato.`,
        ).not.toMatch(/Ciao\s+,/);
        expect(
          m.html,
          `${m.quale} ha perso il saluto: senza nome la frase deve diventare «Ciao,», non sparire.`,
        ).toContain('Ciao,');
      }
    });
  }

  it('col nome scritto lo usano, e il saluto resta una frase sola', () => {
    for (const m of messaggi('Marco')) {
      expect(m.html, `${m.quale} non saluta più per nome`).toContain('Ciao Marco,');
    }
  });

  it('il nome lo ripuliscono: è testo scritto da un\'altra persona', () => {
    for (const m of messaggi('<script>x</script>')) {
      expect(m.html, `${m.quale} ha lasciato passare del codice dentro il saluto`).not.toContain('<script>');
      expect(m.html).toContain('Ciao &lt;script&gt;');
    }
  });

  it('gli spazi intorno al nome non diventano parte del saluto', () => {
    for (const m of messaggi('  Marco  ')) {
      expect(m.html, `${m.quale} saluta con gli spazi dentro`).toContain('Ciao Marco,');
    }
  });
});
