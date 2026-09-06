/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * ALLA CASSA IL PULSANTE SI PREMEVA E NON SUCCEDEVA NIENTE.
 *
 * Com'e' nato. Un'ondata ha scritto `vaiAlPrimoBlocco()`, che porta la persona
 * sul primo riquadro annunciato (`role="alert"`) della pagina. Un'altra l'ha
 * riusato sul pulsante del telefono e nel frattempo ha allargato i motivi di
 * blocco alla fascia oraria di consegna — che un riquadro non ce l'ha. Da li'
 * in poi: bozza salvata da ospite con consegna «Adesso», cassa riaperta dopo
 * le 21, pulsante sbiadito ma premibile, e il tocco finiva nel vuoto.
 *
 * QUESTA PROVA NON GUARDA IL CASO DI OGGI. Guarda la regola: **nessun motivo
 * che spegne il pulsante puo' esistere senza la sua frase a schermo**. Il
 * quinto motivo che qualcuno aggiungera' domani, se arriva senza messaggio,
 * fa diventare rossa la prova qui sotto — esattamente come quello della
 * fascia oraria.
 *
 * Due lenti, perche' una sola non basterebbe:
 *  ① la LISTA — le cause di `ordineBloccato` e quelle di `motivoDelBlocco`
 *    devono essere la stessa lista, verbatim. Un motivo in piu' da una parte
 *    sola e' un pulsante muto che aspetta solo di essere premuto.
 *  ② il COMPORTAMENTO — il riepilogo si monta davvero e si preme davvero: da
 *    bloccato deve esserci un riquadro annunciato con dentro il motivo, e il
 *    pulsante ci deve portare sopra il fuoco. Non si cerca una parola in un
 *    file: si esegue il componente vero.
 *
 * COSA RESTA SCOPERTO. La pagina della cassa (1.500 righe, `use client`, dati
 * da Supabase) non si monta: che sia LEI a passare il motivo al riepilogo si
 * legge nel sorgente. E il montaggio gira in jsdom, dove `scrollIntoView` non
 * esiste: lo scorrimento vero non e' provato qui, solo il fuoco.
 */

const RADICE = process.cwd();
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');
const CASSA = leggi('app/checkout/page.tsx');

/** Via i commenti: quello che conta e' il codice che gira. */
function senzaCommenti(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/**
 * Taglia un'espressione nei suoi pezzi di primo livello, saltando le stringhe e
 * tutto cio' che sta dentro parentesi: cosi' i due punti di «disponibilità:
 * riduci le quantita'» non vengono scambiati per il ramo di un `? :`.
 *
 * Restituisce i pezzi e, in mezzo, i separatori trovati (`?` oppure `:`).
 */
function pezziDiPrimoLivello(espressione: string): { pezzi: string[]; separatori: string[] } {
  const pezzi: string[] = [];
  const separatori: string[] = [];
  let corrente = '';
  let profondita = 0;
  let apice: string | null = null;

  for (let i = 0; i < espressione.length; i++) {
    const c = espressione[i];
    if (apice) {
      corrente += c;
      if (c === '\\') { corrente += espressione[++i] ?? ''; continue; }
      if (c === apice) apice = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { apice = c; corrente += c; continue; }
    if ('([{'.includes(c)) { profondita++; corrente += c; continue; }
    if (')]}'.includes(c)) { profondita--; corrente += c; continue; }
    // `?.` e `??` non aprono un ramo: sono altro.
    const prossimo = espressione[i + 1] ?? '';
    if (profondita === 0 && c === '?' && prossimo !== '.' && prossimo !== '?') {
      pezzi.push(corrente); separatori.push('?'); corrente = ''; continue;
    }
    if (profondita === 0 && c === ':' && espressione[i - 1] !== '?') {
      pezzi.push(corrente); separatori.push(':'); corrente = ''; continue;
    }
    corrente += c;
  }
  pezzi.push(corrente);
  return { pezzi, separatori };
}

const compatta = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Le cause che spengono il pulsante, lette da `ordineBloccato`. */
function causeCheBloccano(): string[] {
  const m = senzaCommenti(CASSA).match(/const ordineBloccato\s*=\s*([^;]+);/);
  expect(m, 'il freno `ordineBloccato` non esiste piu\' con questo nome').toBeTruthy();
  return m![1].split('||').map(compatta).filter(Boolean);
}

/** Le cause che hanno una frase, lette da `motivoDelBlocco`. */
function causeCheParlano(): { causa: string; frase: string }[] {
  const m = senzaCommenti(CASSA).match(/const motivoDelBlocco\s*=\s*([^;]+);/);
  expect(m, 'la lista delle frasi (`motivoDelBlocco`) non esiste piu\' con questo nome').toBeTruthy();
  const { pezzi, separatori } = pezziDiPrimoLivello(m![1]);
  // Una catena `C1 ? F1 : C2 ? F2 : … : null` alterna sempre ? e :.
  expect(separatori.join(''), 'la catena dei motivi non ha piu\' la forma «causa ? frase : …»')
    .toMatch(/^(\?:)+$/);
  const coppie: { causa: string; frase: string }[] = [];
  for (let i = 0; i + 1 < pezzi.length - 1; i += 2) {
    coppie.push({ causa: compatta(pezzi[i]), frase: compatta(pezzi[i + 1]) });
  }
  return coppie;
}

describe('① nessun motivo di blocco resta senza la sua frase', () => {
  it('le cause che spengono il pulsante e quelle che parlano sono la STESSA lista', () => {
    const bloccano = causeCheBloccano();
    const parlano = causeCheParlano().map((c) => c.causa);

    // Non e' la prova del caso di oggi: e' la prova della regola. Un motivo
    // aggiunto domani a `ordineBloccato` e dimenticato di la' cade qui.
    const mute = bloccano.filter((c) => !parlano.includes(c));
    expect(mute, `questi motivi spengono il pulsante senza dire perche': ${mute.join(' | ')}`)
      .toEqual([]);

    // E il contrario: una frase per un motivo che non blocca piu' e' un
    // messaggio che nessuno vedra' mai, cioe' una bugia che invecchia.
    const orfane = parlano.filter((c) => !bloccano.includes(c));
    expect(orfane, `frasi senza piu' un blocco che le mostri: ${orfane.join(' | ')}`).toEqual([]);
  });

  it('e nessuna di quelle frasi e vuota o spenta', () => {
    for (const { causa, frase } of causeCheParlano()) {
      expect(frase, `«${causa}» ha una frase vuota: il pulsante resta muto`).not.toMatch(/^(null|undefined|''|"")$/);
      expect(frase.length, `«${causa}» ha una frase troppo corta per spiegare qualcosa`).toBeGreaterThan(10);
    }
  });

  it('la cassa passa davvero quel motivo al riepilogo, insieme al blocco', () => {
    // Il limite dichiarato: questa riga si legge, non si esegue. La pagina non
    // si monta. Le due righe stanno appaiate apposta: chi spegne, spiega.
    const pulito = senzaCommenti(CASSA);
    expect(pulito, 'il riepilogo riceve il blocco ma non il motivo').toMatch(
      /disabled=\{ordineBloccato\}\s*motivoBlocco=\{motivoDelBlocco\}/,
    );
  });

  it('e sul telefono, se un riquadro non c\'e\', il motivo si dice lo stesso', () => {
    // La barra incollata in fondo e' l'unico pulsante che si vede sul telefono.
    // `fondoDellaBarra` la usa solo lei: e' un'ancora di codice, non di commento.
    const pulito = senzaCommenti(CASSA);
    const barra = pulito.slice(pulito.indexOf('fondoDellaBarra('));
    expect(barra, 'il tocco puo\' di nuovo finire nel vuoto').toMatch(
      /if \(!vaiAlPrimoBlocco\(\)[\s\S]{0,60}toast\.error\(motivoDelBlocco\)/,
    );
  });
});

describe('② il riepilogo, montato e premuto davvero', () => {
  let OrderSummary: unknown;
  let vaiAlPrimoBlocco: () => boolean;

  beforeAll(async () => {
    const mod = await monta('components/checkout/OrderSummary.tsx');
    OrderSummary = mod.OrderSummary;
    vaiAlPrimoBlocco = mod.vaiAlPrimoBlocco as () => boolean;
    // jsdom non implementa lo scorrimento: qui interessa dove finisce il fuoco.
    Element.prototype.scrollIntoView = function scrollIntoView() { /* jsdom */ };
  });

  const base = {
    subtotal: 20, shipping: 3, pickupDiscount: 0, couponDiscount: 0,
    total: 23, isCheckingOut: false, paymentMethod: 'cod' as const,
  };

  it('da bloccato mostra un riquadro annunciato con dentro il motivo', () => {
    const motivo = 'A quest’ora la consegna immediata non è disponibile. Scegli una fascia di domani.';
    const s = accendi(OrderSummary, { ...base, disabled: true, motivoBlocco: motivo });
    const avviso = s.radice.querySelector('[role="alert"]');
    expect(avviso, 'il pulsante e spento e a schermo non c\'e nessuna spiegazione').toBeTruthy();
    expect(testoVisibile(avviso)).toContain('Scegli una fascia di domani');
    s.smonta();
  });

  it('premendolo, il fuoco finisce su quella spiegazione: il tocco non va nel vuoto', () => {
    const s = accendi(OrderSummary, {
      ...base, disabled: true, motivoBlocco: 'Per oggi non ci sono più fasce disponibili. Scegli Domani.',
    });
    const pulsante = s.radice.querySelector('button')!;
    expect(pulsante.getAttribute('aria-disabled'), 'il pulsante non dichiara di essere bloccato').toBe('true');
    s.agisci(() => clicca(pulsante));
    const avviso = s.radice.querySelector('[role="alert"]');
    expect(document.activeElement, 'premere non porta da nessuna parte').toBe(avviso);
    s.smonta();
  });

  it('quando non c\'e nessun blocco non compare nessun falso allarme', () => {
    const s = accendi(OrderSummary, { ...base, disabled: false, motivoBlocco: null });
    expect(s.radice.querySelector('[role="alert"]')).toBeNull();
    s.smonta();
  });

  it('e chi guida il pulsante sa se la spiegazione l\'ha trovata o no', () => {
    // Il ritorno e' la rete di sicurezza: senza, chi chiama crede di aver
    // spiegato qualcosa mentre lo schermo e muto.
    document.body.innerHTML = '';
    expect(vaiAlPrimoBlocco(), 'con lo schermo senza riquadri dice comunque «fatto»').toBe(false);
    document.body.innerHTML = '<div role="alert">motivo</div>';
    expect(vaiAlPrimoBlocco()).toBe(true);
    document.body.innerHTML = '';
  });
});
