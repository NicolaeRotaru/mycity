import { describe, it, expect } from 'vitest';
import { homeCtaHref } from '@/lib/home-site';

/**
 * 30/8/2026 (R027) — UN CONTROLLO DICHIARATO CHE NON ESISTEVA.
 *
 * In cima al renderer dei blocchi CMS c'e' scritto «link CTA solo https/percorso
 * interno». Chi legge quella riga smette di preoccuparsi. Ma il controllo vero,
 * `homeCtaHref`, restituiva la stringa cosi' com'era: bastava che non fosse
 * vuota. Il valore finiva dritto dentro `<a href>`, quindi `javascript:` e
 * `//sito-di-un-altro` sarebbero passati.
 *
 * Oggi non era sfruttabile perche' tutte le strade di scrittura passano prima
 * dallo schema di validazione, che gia' impone https o percorso interno. Ma una
 * difesa dichiarata dove non c'e' e' peggio di una difesa che manca e si sa:
 * il giorno in cui qualcuno salva la home per un'altra strada — un import, una
 * riga messa a mano nel database, un blocco nuovo — nessuno va a ricontrollare,
 * perche' il commento dice che qualcuno controlla.
 *
 * Adesso il controllo sta nel punto in cui e' dichiarato: tutto quello che non
 * e' `https://…` o un percorso interno che comincia con una sola barra torna
 * `null`, e il bottone semplicemente non si disegna.
 */
describe('il collegamento del bottone della home', () => {
  it('lascia passare gli indirizzi https e i percorsi del nostro sito', () => {
    expect(homeCtaHref('https://mycity.it/negozi')).toBe('https://mycity.it/negozi');
    expect(homeCtaHref('/categorie')).toBe('/categorie');
    expect(homeCtaHref('  /promozioni  ')).toBe('/promozioni');
  });

  it('non disegna il bottone quando non c e niente da collegare', () => {
    expect(homeCtaHref('')).toBeNull();
    expect(homeCtaHref('   ')).toBeNull();
    expect(homeCtaHref(undefined)).toBeNull();
    expect(homeCtaHref(null)).toBeNull();
  });

  it('non manda il cliente su un altro sito ne esegue codice al posto suo', () => {
    // Il caso che fa male: un href che esegue codice nella pagina del cliente.
    expect(homeCtaHref('javascript:alert(document.cookie)'), 'un bottone della home puo far eseguire codice al cliente').toBeNull();
    expect(homeCtaHref('JaVaScRiPt:alert(1)'), 'basta cambiare le maiuscole per aggirare il controllo').toBeNull();
    expect(homeCtaHref('data:text/html,<script>1</script>'), 'un bottone della home puo aprire una pagina costruita dall attaccante').toBeNull();
    // «//altro-sito» sembra un percorso interno e invece porta fuori.
    expect(homeCtaHref('//negozio-falso.it/paga'), 'il bottone porta su un altro sito travestito da percorso interno').toBeNull();
    expect(homeCtaHref('http://negozio-falso.it'), 'un collegamento in chiaro, dove la connessione si puo leggere per strada').toBeNull();
  });
});
