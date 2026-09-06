import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 6/9/2026 — PER PAGARE IL PANE BISOGNAVA PRIMA DICHIARARSI VENDITORE O RIDER.
 *
 * Il modulo di registrazione era uguale per tutti: apriva con «Come vuoi usare
 * MyCity?» e tre mattonelle — Acquirente, Venditore, Rider — e chiudeva con
 * «Registrati come acquirente». Chi ci arriva dal carrello o dalla cassa non
 * sta scegliendo un mestiere: sta finendo un ordine. Quella domanda è un passo
 * in più piantato dentro il percorso d'acquisto, ed è attrito che si paga in
 * carrelli lasciati a metà. L'informazione per toglierlo c'era già: il link
 * porta con sé `returnTo`.
 *
 * ⚪ COSA QUESTA PROVA NON FA. In questa repo un .tsx non si può importare in
 * una prova (`jsx: preserve` in tsconfig, che è di tutti e non si tocca):
 * quindi la pagina non viene montata e nessuno qui vede i pixel. Quello che
 * facciamo è rileggere la riga vera dal sorgente e farci passare dentro gli
 * indirizzi veri — la regola che decide viene provata, il disegno no.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/sign-up/page.tsx'), 'utf8');

/** Ripesca dal sorgente la regola vera che decide, e la rende eseguibile. */
function regolaScrittaNelSorgente(): RegExp {
  const riga = PAGINA.match(/return (\/.*\/)\.test\(returnTo\);/);
  if (!riga) throw new Error('la riga che decide non è più in app/sign-up/page.tsx');
  const [, corpo] = riga;
  const chiusura = corpo.lastIndexOf('/');
  return new RegExp(corpo.slice(1, chiusura), corpo.slice(chiusura + 1));
}

describe('da dove arriva chi si sta registrando', () => {
  const dalCarrello = (returnTo: string) => regolaScrittaNelSorgente().test(returnTo);

  it('dal carrello e dalla cassa sta comprando', () => {
    expect(dalCarrello('/checkout')).toBe(true);
    expect(dalCarrello('/cart')).toBe(true);
    expect(dalCarrello('/checkout/success')).toBe(true);
    expect(dalCarrello('/cart?coupon=PANE')).toBe(true);
  });

  it('da tutto il resto no, e il modulo resta quello di sempre', () => {
    expect(dalCarrello('')).toBe(false);
    expect(dalCarrello('/')).toBe(false);
    expect(dalCarrello('/stores/pane-quotidiano')).toBe(false);
    expect(dalCarrello('/profile')).toBe(false);
  });

  it('un indirizzo che comincia allo stesso modo non è la cassa', () => {
    // Senza il confine dopo la parola «/checkout-guida» passerebbe per cassa, e
    // a chi legge una guida sparirebbe la scelta del ruolo.
    expect(dalCarrello('/checkout-guida')).toBe(false);
    expect(dalCarrello('/cartoleria')).toBe(false);
  });

  it('non si guarda l\'indirizzo di un altro sito', () => {
    // `returnTo` arriva da chi apre il link: deve cominciare da noi.
    expect(dalCarrello('https://esempio.it/checkout')).toBe(false);
  });
});

describe('cosa cambia a video per chi arriva dalla cassa', () => {
  it('la scelta del ruolo è appesa a quella domanda, non sempre a video', () => {
    expect(PAGINA).toContain('Come vuoi usare MyCity?');
    expect(PAGINA).toContain('{dalCarrello ? null : (');
  });

  it('il pulsante parla dell\'ordine, non del mestiere', () => {
    expect(PAGINA).toContain("Crea l\\'account e continua l\\'ordine");
  });

  it('il ruolo di partenza resta acquirente, qualunque cosa dica il link', () => {
    expect(PAGINA).toContain("const initialRole: Role = dalCarrello ? 'buyer'");
  });

  it('la regola della password resta scritta mentre si digita', () => {
    // Era `placeholder`, cioè il grigio dentro al campo che sparisce alla prima
    // lettera: la regola se ne andava proprio quando serviva.
    expect(PAGINA).toContain('hint="Almeno 8 caratteri"');
    expect(PAGINA).not.toContain('placeholder="Almeno 8 caratteri"');
  });
});
