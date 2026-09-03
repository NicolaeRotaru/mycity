/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import {
  BARRE_SENZA_CORSIA,
  CORSIE_IN_FONDO,
  MISURE_TAILWIND,
  larghezzaSenzaBarreNonDichiarate,
  type MisuraTailwind,
} from '@/lib/ui/barra-in-fondo';

/**
 * 3/9/2026 — DUE COSE CHE GALLEGGIANO COPRIVANO IL PULSANTE CHE FA COMPRARE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Sulla scheda prodotto, dal telefono, compare in fondo la barra con il prezzo e «Aggiungi al
 * carrello». Sopra quella barra ne finivano altre due:
 *
 *  ① il pulsante tondo dell'assistenza (56×56, a destra), che chi ha fatto l'accesso vede su OGNI
 *    pagina. Stava a 96 pixel dal fondo — un numero scritto a mano, pensato per scavalcare la sola
 *    barra a schede. Misurato in un browser a 390 pixel: 2.491 pixel quadrati sopra il pulsante
 *    d'acquisto, il 23% della sua superficie, e toccando a 3/4 e a 9/10 della sua larghezza — dove
 *    arriva il pollice destro — rispondeva l'assistenza. Il cliente credeva di comprare e apriva
 *    una chat;
 *  ② il banner «Metti MyCity in schermata Home», a 80 pixel dal fondo e alto un centinaio, quindi
 *    esattamente sopra la stessa fascia. E allo stesso livello di sovrapposizione (z-30 tutti e
 *    due) vince chi viene dopo nel documento: il banner.
 *
 * ── La malattia, che non era il numero ──────────────────────────────────────────────────────────
 * Non esisteva nessun posto dove fosse scritto CHI STA SOPRA CHI in fondo allo schermo: quattro
 * elementi in quattro file, ognuno che indovinava un numero. Ora l'ordine sta in
 * `lib/ui/barra-in-fondo.ts`, chi occupa una corsia dichiara quanto è alto in una variabile CSS, e
 * chi gli sta sopra somma le corsie sotto di sé.
 *
 * ── Cosa prova questo file, e perché non cerca parole ───────────────────────────────────────────
 * Monta i tre pezzi VERI, si prende il `bottom` che scrivono davvero, e RIFÀ IL CONTO in pixel:
 * ogni elemento deve partire da sopra il tetto di quello che gli sta sotto. Il conto gira su una
 * gamma di altezze — anche assurde — perché una somma che dimentica una corsia passerebbe quando
 * quella corsia è bassa e fallirebbe in strada quando cresce.
 *
 * ⚠️ Cosa NON prova: che a schermo sia bello. Qui non c'è un motore di layout: le altezze le
 * dichiarano i componenti stessi (e in questa prova valgono quanto dice `ALTEZZA_FINTA`), non le
 * misura un browser. Che il pollice non arrivi più sulla chat resta da vedere su un telefono vero.
 */

/** Quanto sono alti gli elementi, in questa prova: jsdom non impagina, quindi glielo diciamo noi. */
const ALTEZZA_FINTA = 76;

/** La barra gestuale dell'iPhone: zero su un telefono senza, 34 su uno con. */
const SAFE_AREA = [0, 34];

const GLOBALS = readFileSync('app/globals.css', 'utf8');

/** L'altezza della barra a schede, letta dal foglio di stile vero. */
function altezzaBarraSchede(): number {
  const m = GLOBALS.match(/--tabbar-height:\s*(\d+)px/);
  expect(m, 'in globals.css non c\'è più --tabbar-height: questa prova non misura niente').toBeTruthy();
  return Number(m![1]);
}

/** Il pavimento sotto cui chi galleggia non scende, sul telefono. */
function pavimentoDelTelefono(): number {
  const m = GLOBALS.match(/--fondo-minimo:\s*([\d.]+)rem/);
  expect(m, 'in globals.css non c\'è più --fondo-minimo: la prova va riscritta').toBeTruthy();
  return Number(m![1]) * 16;
}

// ─────────────────────────────────────────────────────────────────────────────
// Il metro: risolvere un `calc(...)` in pixel.
// ─────────────────────────────────────────────────────────────────────────────

/** Un pezzo di somma: `env(...)`, `var(--x, 0px)`, `72px`, `1.5rem`. */
function pezzoInPixel(pezzo: string, valori: Record<string, number>, safe: number): number {
  const t = pezzo.trim();
  if (t.startsWith('env(')) return safe;
  const v = t.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (v) {
    const nome = v[1];
    if (nome in valori) return valori[nome];
    return v[2] ? pezzoInPixel(v[2], valori, safe) : 0;
  }
  const px = t.match(/^(-?[\d.]+)px$/);
  if (px) return Number(px[1]);
  const rem = t.match(/^(-?[\d.]+)rem$/);
  if (rem) return Number(rem[1]) * 16;
  throw new Error(`non so quanto vale «${t}» in pixel`);
}

/** Da `calc(a + b + c)` ai pixel. */
function calcInPixel(espressione: string, valori: Record<string, number>, safe: number): number {
  const m = espressione.trim().match(/^calc\(([\s\S]*)\)$/);
  expect(m, `«${espressione}» non è un calc`).toBeTruthy();
  return m![1].split('+').reduce((somma, p) => somma + pezzoInPixel(p, valori, safe), 0);
}

/**
 * Il `bottom` di un elemento, in pixel: `calc(...)` oppure `max(pavimento, calc(...))`.
 * Lancia se la forma non è nessuna delle due: meglio rossa che finta.
 */
function inPixel(pezzo: Pezzo, valori: Record<string, number>, safe: number): number {
  const t = pezzo.bottom.trim();
  const errore =
    `${pezzo.nome} non somma più le corsie che ha sotto (il suo bottom vale «${pezzo.bottom}»): ` +
    'è tornato a un numero scritto a mano, e chi sta sotto torna coperto';
  const conPavimento = t.match(/^max\(\s*([\s\S]+?)\s*,\s*(calc\([\s\S]*\))\s*\)$/);
  if (conPavimento) {
    return Math.max(
      pezzoInPixel(conPavimento[1], valori, safe),
      calcInPixel(conPavimento[2], valori, safe),
    );
  }
  expect(t.startsWith('calc('), errore).toBe(true);
  return calcInPixel(t, valori, safe);
}

// ─────────────────────────────────────────────────────────────────────────────
// I tre pezzi veri, montati.
// ─────────────────────────────────────────────────────────────────────────────

type Pezzo = { nome: string; bottom: string; classi: string };

let barraAcquisto: Pezzo;
let bannerInstalla: Pezzo;
let pulsanteAssistenza: Pezzo;
/** Le altezze che i componenti hanno DICHIARATO da soli nelle variabili delle loro corsie. */
const dichiarate: Record<string, string> = {};

function fingiIlBrowser() {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => ALTEZZA_FINTA,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
}

beforeAll(async () => {
  fingiIlBrowser();

  // ① La barra «Aggiungi al carrello»: compare quando si è scorso oltre mezzo schermo.
  const mBarra = await monta('components/StickyAddToCart.tsx');
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 2000 });
  const sBarra = accendi(mBarra.default, { price: 12.5, available: true, onAdd: () => {} });
  sBarra.agisci(() => window.dispatchEvent(new window.Event('scroll')));
  const elBarra = sBarra.radice.querySelector<HTMLElement>('[role="region"]')!;
  expect(elBarra, 'la barra «Aggiungi al carrello» non è comparsa: la prova non guarda niente').toBeTruthy();
  barraAcquisto = { nome: 'la barra «Aggiungi al carrello»', bottom: elBarra.style.bottom, classi: elBarra.className };

  // ② Il banner «Metti MyCity in schermata Home»: il browser offre l'installazione, e la persona
  //    è già tornata più volte.
  //
  //    ⚠️ Le visite si portano a nove con l'evento `storage` (la sincronia fra schede) e non
  //    scrivendo in localStorage prima di montare: il conteggio delle visite dentro il componente
  //    riparte da zero a ogni montaggio e sovrascriverebbe il numero. È un difetto suo, segnalato a
  //    parte; qui serve solo mettere il banner a video per misurarne la posizione.
  const mBanner = await monta('components/PWAInstallBanner.tsx');
  const sBanner = accendi(mBanner.default, {});
  await attendi();
  sBanner.agisci(() => {
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'mc_pwa_visits', newValue: '9' }));
    window.dispatchEvent(new window.Event('beforeinstallprompt', { cancelable: true }));
  });
  const elBanner = sBanner.radice.querySelector<HTMLElement>('div.fixed')!;
  expect(elBanner, 'il banner «Metti MyCity in schermata Home» non è comparso: la prova non guarda niente').toBeTruthy();
  bannerInstalla = { nome: 'il banner «Metti MyCity in schermata Home»', bottom: elBanner.style.bottom, classi: elBanner.className };

  // ③ Il pulsante tondo dell'assistenza: un compratore che ha fatto l'accesso, su una scheda prodotto.
  (globalThis as Record<string, unknown>).__PROFILO__ = { isAuthenticated: true, isBuyer: true };
  (globalThis as Record<string, unknown>).__PERCORSO_FINTO__ = '/product/pane-di-segale';
  const mChat = await monta('components/SupportChatButton.tsx');
  const sChat = accendi(mChat.default, {});
  const elChat = sChat.radice.querySelector<HTMLElement>('button[aria-label="Assistenza"]')!;
  expect(elChat, 'il pulsante dell\'assistenza non c\'è: la prova non guarda niente').toBeTruthy();
  pulsanteAssistenza = { nome: 'il pulsante tondo dell\'assistenza', bottom: elChat.style.bottom, classi: elChat.className };

  // Le altezze che i due occupanti di corsia hanno pubblicato mentre erano a video.
  for (const c of CORSIE_IN_FONDO) {
    dichiarate[c.variabile] = document.documentElement.style.getPropertyValue(c.variabile);
  }
});

describe('chi occupa una corsia in fondo allo schermo dice quanto è alto', () => {
  it('la barra «Aggiungi al carrello» dichiara la propria altezza', () => {
    expect(
      dichiarate['--altezza-barra-acquisto'],
      'la barra non dice più quanto è alta: chi le sta sopra torna a indovinare, e il pulsante d\'acquisto torna coperto',
    ).toBe(`${ALTEZZA_FINTA}px`);
  });

  it('il banner «Metti MyCity in schermata Home» dichiara la propria altezza', () => {
    expect(
      dichiarate['--altezza-banner-installa'],
      'il banner non dice più quanto è alto: il pulsante dell\'assistenza gli finisce sopra',
    ).toBe(`${ALTEZZA_FINTA}px`);
  });
});

describe('sul telefono niente galleggia sopra il pulsante che fa comprare', () => {
  const barraSchede = altezzaBarraSchede();
  const pavimento = pavimentoDelTelefono();

  /**
   * Le altezze su cui si rifà il conto. Quelle vere misurate in un browser sono ~80 per la barra
   * d'acquisto e ~120 per il banner; le altre servono a scoprire una somma che dimentica una
   * corsia: con la corsia bassa il conto tornerebbe lo stesso, e si romperebbe in strada.
   */
  const ALTEZZE = [0, 40, 80, 120, 240];

  function scenario(altezzaBarra: number, altezzaBanner: number, safe: number) {
    const valori: Record<string, number> = {
      '--fondo-minimo': pavimento,
      '--tabbar-height': barraSchede,
      '--altezza-banner-cookie': 0,
      '--altezza-barra-acquisto': altezzaBarra,
      '--altezza-banner-installa': altezzaBanner,
    };
    return {
      barra: inPixel(barraAcquisto, valori, safe),
      banner: inPixel(bannerInstalla, valori, safe),
      chat: inPixel(pulsanteAssistenza, valori, safe),
    };
  }

  it('il pulsante dell\'assistenza parte da sopra il tetto della barra d\'acquisto', () => {
    for (const safe of SAFE_AREA) {
      for (const h of ALTEZZE) {
        const { barra, chat } = scenario(h, 0, safe);
        expect(
          chat,
          `barra gestuale ${safe}px, barra d'acquisto alta ${h}px: il pulsante tondo parte a ${chat}px ` +
            `mentre la barra arriva a ${barra + h}px — si sovrappongono per ${barra + h - chat}px, ` +
            'e il tocco che doveva comprare apre l\'assistenza',
        ).toBeGreaterThanOrEqual(barra + h);
      }
    }
  });

  it('il banner «Installa MyCity» parte da sopra il tetto della barra d\'acquisto', () => {
    for (const safe of SAFE_AREA) {
      for (const h of ALTEZZE) {
        const { barra, banner } = scenario(h, 0, safe);
        expect(
          banner,
          `barra gestuale ${safe}px, barra d'acquisto alta ${h}px: il banner parte a ${banner}px ` +
            `mentre la barra arriva a ${barra + h}px — copre il pulsante d'acquisto per ${barra + h - banner}px`,
        ).toBeGreaterThanOrEqual(barra + h);
      }
    }
  });

  /**
   * IL PAVIMENTO, e perché questa prova esiste.
   *
   * Passando dal numero fisso alla somma delle corsie si rischiava di spostare il difetto sulla
   * pagina peggiore: in cassa e nella pagina del fattorino la barra a schede è nascosta e vale
   * zero, ma al suo posto c'è un'altra barra («Conferma ordine») che la propria corsia non la
   * dichiara ancora. Senza pavimento la somma darebbe 24 pixel e il pulsante tondo finirebbe sopra
   * «Conferma ordine». 96 pixel è la misura che il pulsante aveva prima (`bottom-24`): finché
   * quelle barre non dichiarano la loro altezza, di lì non si scende.
   */
  const COM_ERA_PRIMA = 96;

  it('dove nessuna barra dichiara la propria corsia (la cassa) non scende più di prima', () => {
    const valori = {
      '--fondo-minimo': pavimento,
      '--tabbar-height': 0, // in cassa la barra a schede è nascosta: body.senza-tabbar
      '--altezza-banner-cookie': 0,
      '--altezza-barra-acquisto': 0,
      '--altezza-banner-installa': 0,
    };
    for (const pezzo of [pulsanteAssistenza, bannerInstalla]) {
      const dove = inPixel(pezzo, valori, 0);
      expect(
        dove,
        `in cassa ${pezzo.nome} scenderebbe a ${dove}px, mentre prima stava a ${COM_ERA_PRIMA}px: ` +
          'sotto c\'è la barra «Conferma ordine», che la propria altezza non la dichiara ancora — ' +
          'il difetto si sposterebbe sulla pagina che conta di più',
      ).toBeGreaterThanOrEqual(COM_ERA_PRIMA);
    }
  });

  it('e i due che galleggiano non si coprono nemmeno fra loro', () => {
    for (const safe of SAFE_AREA) {
      for (const h of ALTEZZE) {
        for (const b of ALTEZZE) {
          const { banner, chat } = scenario(h, b, safe);
          expect(
            chat,
            `barra gestuale ${safe}px, banner alto ${b}px: il pulsante tondo parte a ${chat}px ` +
              `mentre il banner arriva a ${banner + b}px`,
          ).toBeGreaterThanOrEqual(banner + b);
        }
      }
    }
  });
});

describe('quando due cose si sovrappongono, chi vince non lo decide il caso', () => {
  /** La scala dei livelli dichiarata in tailwind.config.ts, letta dal file vero. */
  const scala = (() => {
    const src = readFileSync('tailwind.config.ts', 'utf8');
    const blocco = src.match(/zIndex:\s*\{([\s\S]*?)\n\s{6}\}/);
    expect(blocco, 'in tailwind.config.ts non c\'è più la scala dei livelli: la prova va riscritta').toBeTruthy();
    const mappa: Record<string, number> = {};
    for (const m of blocco![1].matchAll(/'([\w-]+)':\s*'(\d+)'/g)) mappa[m[1]] = Number(m[2]);
    return mappa;
  })();

  /** Il livello di un elemento, dalle sue classi: `z-banner` passa dalla scala, `z-30` è grezzo. */
  function livello(classi: string): number {
    const m = classi.match(/(?:^|\s)z-([\w-]+)(?![\w-])/);
    expect(m, `«${classi}» non dichiara nessun livello`).toBeTruthy();
    const chiave = m![1];
    if (chiave in scala) return scala[chiave];
    return Number(chiave);
  }

  it('la scala si legge davvero (se no non sta misurando niente)', () => {
    expect(Object.keys(scala).length).toBeGreaterThan(5);
    expect(scala['mobile-nav']).toBeGreaterThan(0);
    expect(scala['banner']).toBeGreaterThan(0);
  });

  it('il banner «Installa MyCity» non sta allo stesso livello della barra d\'acquisto', () => {
    const zBanner = livello(bannerInstalla.classi);
    const zBarra = livello(barraAcquisto.classi);
    expect(
      zBanner,
      `banner e barra d'acquisto stanno tutti e due a ${zBanner}: a parità di livello vince chi viene ` +
        'dopo nel documento, e nel layout il banner viene dopo — il pulsante d\'acquisto finisce sotto',
    ).not.toBe(zBarra);
  });

  it('il pulsante dell\'assistenza usa la corsia dichiarata nella scala, non un numero grezzo', () => {
    const m = pulsanteAssistenza.classi.match(/(?:^|\s)z-([\w-]+)(?![\w-])/);
    expect(
      m && m[1] in scala,
      `il pulsante dell'assistenza dichiara «z-${m?.[1]}», che nella scala non esiste: un numero ` +
        'grezzo non dice a nessuno chi deve stare sopra',
    ).toBe(true);
  });
});

/**
 * 3/9/2026, SECONDO GIRO — IL DIFETTO ERA TORNATO UN PASSO PIÙ IN LÀ.
 *
 * Il pavimento (`--fondo-minimo`) valeva 96 pixel sul telefono e in app/globals.css si abbassava a
 * 24 da 768 in su, con scritto accanto: «sul computer sotto non c'è niente da scavalcare». Non era
 * vero. La barra «Conferma ordine» della cassa è `lg:hidden`: resta a video fino a 1023. Fra 768 e
 * 1023 — ogni iPad in verticale (768, 820, 834) e ogni finestra affiancata su un portatile — tutte
 * le corsie valgono zero, il pavimento valeva 24, e il pulsante tondo dell'assistenza tornava sopra
 * il pulsante che paga: lo stesso difetto che questo file è nato per chiudere.
 *
 * La prova qui sopra non lo vedeva perché leggeva `--fondo-minimo` con la PRIMA occorrenza del
 * file: prendeva i 96 del telefono e non guardava mai quanto vale il pavimento sopra i 768.
 *
 * ── Cosa prova questo blocco, e perché non è una parola cercata ──────────────────────────────────
 * Risolve il foglio di stile a una larghezza data — le `@media` si leggono e si applicano davvero —
 * e confronta il pavimento che ne esce con il registro di lib/ui/barra-in-fondo.ts, dove ogni barra
 * senza corsia dichiara fin dove si vede. Poi va a controllare che quel registro dica la verità:
 * la misura dichiarata deve essere la stessa scritta nel file della cassa. Se qualcuno riabbassa la
 * @media, o sposta la barra della cassa a un'altra misura, il conto non torna più.
 */
describe('il pavimento arriva fin dove arriva la barra che deve proteggere', () => {
  /** Il foglio di stile senza commenti: lì dentro le graffe non aprono niente. */
  const CSS = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '');

  /** Una dichiarazione di variabile, con le condizioni di larghezza in cui vale. */
  type Regola = { da: number; fino: number; valore: number };

  /**
   * Tutte le volte che una variabile viene dichiarata SU `:root`, con la fascia di larghezze in cui
   * quella dichiarazione è attiva. Si scorre il file tenendo una pila di quello che è aperto: una
   * `@media` vale finché non si richiude, e il selettore serve perché `body.senza-tabbar` azzera la
   * stessa variabile su certe pagine — dipende dalla pagina, non dalla larghezza, e qui non conta.
   */
  function dichiarazioniDi(variabile: string): Regola[] {
    const trovate: Regola[] = [];
    type Aperto = { da: number; fino: number; selettore: string };
    const pila: Aperto[] = [];
    const eventi = new RegExp(
      `@(\\w+)([^{;]*)\\{|([^{}@;]*)\\{|\\}|${variabile}:\\s*([\\d.]+)(rem|px)`,
      'g',
    );
    let e: RegExpExecArray | null;
    while ((e = eventi.exec(CSS)) !== null) {
      if (e[1] !== undefined) {
        const condizione = e[1] === 'media' ? e[2] : '';
        pila.push({
          da: Number(condizione.match(/min-width:\s*(\d+)px/)?.[1] ?? 0),
          fino: Number(condizione.match(/max-width:\s*(\d+)px/)?.[1] ?? Infinity),
          selettore: '',
        });
      } else if (e[3] !== undefined) {
        pila.push({ da: 0, fino: Infinity, selettore: e[3].trim() });
      } else if (e[0] === '}') {
        pila.pop();
      } else {
        const dentro = pila[pila.length - 1];
        if (!dentro || !/(^|,)\s*:root\s*(,|$)/.test(dentro.selettore)) continue;
        trovate.push({
          da: Math.max(0, ...pila.map((a) => a.da)),
          fino: Math.min(Infinity, ...pila.map((a) => a.fino)),
          valore: Number(e[4]) * (e[5] === 'rem' ? 16 : 1),
        });
      }
    }
    return trovate;
  }

  /** Quanto vale una variabile a una larghezza data: vince l'ultima dichiarazione che si applica. */
  function valoreA(variabile: string, larghezza: number): number {
    const valide = dichiarazioniDi(variabile).filter((r) => larghezza >= r.da && larghezza <= r.fino);
    expect(valide.length, `a ${larghezza}px nessuna regola dichiara ${variabile}`).toBeGreaterThan(0);
    return valide[valide.length - 1].valore;
  }

  /** La misura da cui un elemento sparisce, letta dalle sue classi: `lg:hidden` → 'lg'. */
  function misuraDaCuiSparisce(classi: string): string | undefined {
    return classi.match(/(?:^|\s)(\w+):hidden(?:\s|$)/)?.[1];
  }

  /** Le classi della barra «Conferma ordine» della cassa, dal file vero. */
  const classiDellaCassa = readFileSync('app/checkout/page.tsx', 'utf8').match(
    /className="([^"]*fixed inset-x-0 bottom-0[^"]*)"/,
  )?.[1];

  /** Le classi della barra a schede, dal file vero. */
  const classiDellaBarraSchede = readFileSync('components/MobileTabBar.tsx', 'utf8').match(
    /className="([^"]*fixed bottom-0 inset-x-0[^"]*)"/,
  )?.[1];

  /** La misura che il pulsante tondo aveva prima del registro (`bottom-24`). Di lì non si scende. */
  const COM_ERA_PRIMA = 96;

  it('il foglio di stile si legge davvero (se no non sta misurando niente)', () => {
    expect(
      dichiarazioniDi('--fondo-minimo').length,
      'in globals.css il pavimento non si dichiara più: questa prova va riscritta',
    ).toBeGreaterThanOrEqual(1);
    expect(valoreA('--fondo-minimo', 360)).toBe(COM_ERA_PRIMA);
  });

  it('il registro dice la verità: la barra della cassa sparisce dalla misura che dichiara', () => {
    const registrata = BARRE_SENZA_CORSIA.find((b) => b.dove === 'app/checkout/page.tsx');
    expect(registrata, 'la barra della cassa non è più nel registro delle barre senza corsia').toBeTruthy();
    expect(classiDellaCassa, 'in cassa non si trova più la barra incollata in fondo: prova da riscrivere').toBeTruthy();
    expect(
      misuraDaCuiSparisce(classiDellaCassa!),
      `il registro dice che «Conferma ordine» sparisce da «${registrata!.spariceDa}», il file della ` +
        `cassa dice «${misuraDaCuiSparisce(classiDellaCassa!)}»: il pavimento sta proteggendo una ` +
        'fascia di schermi diversa da quella dove la barra si vede davvero',
    ).toBe(registrata!.spariceDa);
  });

  it('il pavimento non si abbassa finché una barra senza corsia è ancora a video', () => {
    const soglia = larghezzaSenzaBarreNonDichiarate();
    // 820 e 834 sono gli iPad in verticale: la fascia dove il difetto era tornato.
    for (const larghezza of [360, 375, 640, 768, 820, 834, soglia - 1]) {
      expect(
        valoreA('--fondo-minimo', larghezza),
        `a ${larghezza}px il pavimento vale ${valoreA('--fondo-minimo', larghezza)}px, ma lì sotto c'è ` +
          `ancora ${BARRE_SENZA_CORSIA.map((b) => b.nome).join(', ')}: il pulsante tondo torna sopra ` +
          'il pulsante che paga',
      ).toBeGreaterThanOrEqual(COM_ERA_PRIMA);
    }
  });

  it('e su un tablet in verticale il pulsante tondo parte da sopra la barra che paga', () => {
    // Le corsie valgono tutte zero: in cassa la barra a schede è nascosta e nessuna delle altre tre
    // è a video. Resta solo il pavimento a tenere il pulsante sopra «Conferma ordine».
    for (const larghezza of [768, 820, 834, larghezzaSenzaBarreNonDichiarate() - 1]) {
      const valori = {
        '--fondo-minimo': valoreA('--fondo-minimo', larghezza),
        '--tabbar-height': valoreA('--tabbar-height', larghezza),
        '--altezza-banner-cookie': 0,
        '--altezza-barra-acquisto': 0,
        '--altezza-banner-installa': 0,
      };
      for (const pezzo of [pulsanteAssistenza, bannerInstalla]) {
        const dove = inPixel(pezzo, valori, 0);
        expect(
          dove,
          `a ${larghezza}px ${pezzo.nome} parte a ${dove}px dal fondo, mentre in cassa «Conferma ` +
            "ordine» occupa i primi 73: il tocco che doveva pagare apre l'assistenza",
        ).toBeGreaterThanOrEqual(COM_ERA_PRIMA);
      }
    }
  });

  it('la corsia della barra a schede si azzera esattamente dove la barra sparisce', () => {
    // Lo stesso errore, sull'altra coppia di misure: se la barra a schede sparisce da `md` ma la sua
    // corsia resta 72px fin oltre, chi la somma resta alzato sopra il vuoto.
    const misura = misuraDaCuiSparisce(classiDellaBarraSchede ?? '');
    expect(misura, 'la barra a schede non dichiara più da quale misura sparisce').toBeTruthy();
    const soglia = MISURE_TAILWIND[misura as MisuraTailwind];
    expect(soglia, `«${misura}» non è una misura di Tailwind conosciuta`).toBeGreaterThan(0);
    expect(
      valoreA('--tabbar-height', soglia),
      `la barra a schede sparisce da ${soglia}px ma la sua corsia lì vale ancora ` +
        `${valoreA('--tabbar-height', soglia)}px: chi la somma resta alzato sopra il vuoto`,
    ).toBe(0);
    expect(
      valoreA('--tabbar-height', soglia - 1),
      `a ${soglia - 1}px la barra a schede c'è ancora, ma la sua corsia vale zero: chi le sta sopra ` +
        'le finisce addosso',
    ).toBeGreaterThan(0);
  });
});
