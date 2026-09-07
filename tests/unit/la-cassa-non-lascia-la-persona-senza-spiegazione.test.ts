import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 6/9/2026 — QUATTRO PUNTI DELLA CASSA DOVE LA PERSONA RESTAVA SENZA RISPOSTA.
 *
 *  ① «Compra ora · paghi alla consegna» apriva la cassa con la carta gia'
 *     scelta: il pulsante prometteva una cosa, la casella accesa ne diceva
 *     un'altra.
 *  ② Sul telefono il pulsante di conferma si spegneva davvero — fuori dal giro
 *     del tasto Tab, sordo al tocco — senza dire perche'. Sul computer il
 *     gemello era gia' a posto: resta premibile e porta sulla spiegazione.
 *  ③ Chi sceglieva la carta vedeva sparire la casella del proprio credito, e
 *     il totale risalire, senza una riga che dicesse il motivo.
 *  ④ Il codice per la «zona sicura» dell'iPhone era scritto in tutto il sito
 *     ma valeva zero, perche' nessuna pagina dichiarava `viewport-fit: cover`.
 *
 * NOTA SUL LIMITE DI QUESTA PROVA. Qui si legge il sorgente, non si esegue la
 * schermata: il motore delle prove unitarie di questo progetto non sa
 * trasformare i file `.tsx` (`jsx: preserve` in tsconfig.json), quindi un
 * componente non si puo' importare. Sui difetti minori il manuale del lotto
 * ammette la lettura del sorgente. Dove si poteva, invece di cercare una
 * parola si e' messo a confronto DUE file: una prova che passa solo se i due
 * lati continuano a dirsi la stessa cosa.
 */

const CASSA = readFileSync('app/checkout/page.tsx', 'utf-8');
const SCHEDA_PRODOTTO = readFileSync('app/product/[id]/page.tsx', 'utf-8');
const SCELTA_PAGAMENTO = readFileSync('components/checkout/PaymentMethodSelector.tsx', 'utf-8');
const RIEPILOGO = readFileSync('components/checkout/OrderSummary.tsx', 'utf-8');
const GUSCIO = readFileSync('app/layout.tsx', 'utf-8');

/**
 * La barra incollata in fondo, l'unico pulsante che si vede sul telefono.
 * L'ancora e' codice vero (`fondoDellaBarra`, che usa solo lei) e non il testo
 * di un commento: un commento riscritto non deve far sballare una prova.
 */
const barraDelTelefono = () => CASSA.slice(CASSA.indexOf('fondoDellaBarra('));

describe('l intenzione dichiarata sulla scheda prodotto arriva fino alla cassa', () => {
  it('il pulsante «paghi alla consegna» scrive quello che ha promesso', () => {
    const compraOra = SCHEDA_PRODOTTO.slice(
      SCHEDA_PRODOTTO.indexOf('const handleBuyNow'),
      SCHEDA_PRODOTTO.indexOf("router.push('/checkout')"),
    );
    expect(
      compraOra,
      'la cassa riparte da «carta» e il testo del pulsante resta una promessa disattesa',
    ).toContain("ricordaMetodoScelto('cod')");
  });

  it('la cassa raccoglie quell intenzione prima di mostrare il metodo', () => {
    expect(CASSA).toContain('raccogliMetodoScelto()');
  });

  it('i due lati parlano della stessa memoria: chi scrive e chi legge', () => {
    // Se qualcuno cambia il nome della memoria da una parte sola, il viaggio si
    // rompe in silenzio: nessuno sbaglia, semplicemente non si trovano piu'.
    expect(SCELTA_PAGAMENTO).toContain('export function ricordaMetodoScelto');
    expect(SCELTA_PAGAMENTO).toContain('export function raccogliMetodoScelto');
    expect(SCHEDA_PRODOTTO).toContain(
      "import { ricordaMetodoScelto } from '@/components/checkout/PaymentMethodSelector'",
    );
    expect(CASSA).toContain('raccogliMetodoScelto }');
  });

  it('l intenzione si cancella appena letta: vale per un viaggio solo', () => {
    const lettura = SCELTA_PAGAMENTO.slice(SCELTA_PAGAMENTO.indexOf('export function raccogliMetodoScelto'));
    expect(
      lettura,
      'senza cancellarla resta appiccicata e detta il metodo anche agli ordini dopo',
    ).toContain('removeItem');
  });
});

describe('il pulsante di conferma spiega perche non parte', () => {
  it('sul telefono resta premibile e dichiara il blocco, come il gemello sul computer', () => {
    const barra = barraDelTelefono();
    expect(barra).toContain('aria-disabled={ordineBloccato || isCheckingOut}');
    expect(barra).toContain('disabled={isCheckingOut}');
    expect(
      barra,
      'il pulsante del telefono e di nuovo spento davvero: esce dal giro del tasto Tab e non spiega niente',
    ).not.toContain('disabled={isCheckingOut || groups.length === 0');
  });

  it('premuto da bloccato porta la persona sul riquadro che spiega il motivo', () => {
    expect(barraDelTelefono()).toContain('vaiAlPrimoBlocco()');
    expect(RIEPILOGO).toContain('export function vaiAlPrimoBlocco');
    // Stessa mossa per i due pulsanti: scritta due volte si sarebbe separata.
    expect(RIEPILOGO).toContain('[role="alert"]');
    expect(RIEPILOGO).toContain('focus()');
  });

  it('il motivo del blocco e scritto in un posto solo, non ricopiato', () => {
    const quanteVolte = CASSA.split('groups.length === 0 || stockIssues.length > 0').length - 1;
    expect(
      quanteVolte,
      'la condizione e ricopiata: le due copie si separano al primo motivo di blocco in piu',
    ).toBe(1);
  });
});

describe('chi paga con la carta sa che fine fa il suo credito', () => {
  it('la cassa lo dice, invece di far sparire la casella in silenzio', () => {
    expect(CASSA).toContain("{paymentMethod === 'card' && walletEuro > 0 && (");
  });

  it('e offre il modo di usarlo, non solo la brutta notizia', () => {
    expect(CASSA).toContain('Paga alla consegna e usa il credito');
  });
});

describe('la zona sicura dell iPhone', () => {
  it('e dichiarata nel guscio del sito, se no tutti quei conti valgono zero', () => {
    const finestra = GUSCIO.slice(
      GUSCIO.indexOf('export const viewport'),
      GUSCIO.indexOf('const orgSchema'),
    );
    expect(
      finestra,
      'senza viewport-fit cover env(safe-area-inset-*) vale 0 e le barre finiscono sotto la barra gestuale',
    ).toContain("viewportFit: 'cover'");
  });
});

describe('gli angoli si stringono andando verso l interno', () => {
  it('i riquadri dentro i passi della cassa stanno un gradino sotto il contenitore', () => {
    // Il contenitore e' una Card «funnel»: rounded-xl, 16px. Questi tre stanno
    // dentro, quindi 12px. Un raggio che cresce verso l'interno e' l'errore.
    for (const riquadro of [
      'gap-2 rounded-lg border border-olive-200 bg-olive-50',
      'justify-between rounded-lg border border-cream-300 bg-cream-50',
      'gap-3 p-4 rounded-lg border-2 border-cream-300 bg-white',
    ]) {
      expect(CASSA, `riquadro interno tornato piu tondo del contenitore: ${riquadro}`).toContain(riquadro);
    }
  });
});
