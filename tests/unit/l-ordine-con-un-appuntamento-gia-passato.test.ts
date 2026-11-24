/**
 * @vitest-environment jsdom
 */
/**
 * Alle 21:40 nasceva un ordine con scritto sopra «arriva fra le 15 e le 18».
 *
 * IL CASO, riga per riga. Le fasce di oggi finiscono alle 18 e alle 20, e `todayTimesAvailable()`
 * teneva solo quelle con `endHour > oraCorrente`: dalle 20:00 in poi la lista è vuota. L'effetto
 * che riallinea la selezione usciva subito (`if (todayTimes.length === 0) return`), il giorno
 * restava `'today'` — la mattonella «Oggi» non si disabilitava mai, a differenza di «Adesso» — e
 * `slotTodayTime` era partito da `defaultTodayTime()`, che senza fasce future **ripiega sulla
 * prima voce dell'elenco**: «In giornata · 15:00–18:00». `resolveSlotLabel` restituiva quella
 * stringa, che finiva nel corpo della richiesta e su `orders.delivery_slot`.
 *
 * **Non era un testo sbagliato a video: era un appuntamento nel passato preso con un negoziante**
 * che poi deve consegnarlo.
 *
 * E nello stesso riquadro c'erano altre due bugie sull'orario:
 *
 * ② **Tre promesse diverse.** La mattonella «Adesso» diceva «~30–45 min», la riga sotto «In 30-60
 *    minuti dalla conferma del negozio», la fascia preselezionata «In giornata · 15:00–18:00».
 *    Tre risposte alla stessa domanda, nel momento della decisione.
 *
 * ③ **La riga che non ascoltava.** Quel «In 30-60 minuti» era fisso: chi sceglieva «Domani ·
 *    9:00–12:00» continuava a leggere che arrivava in mezz'ora.
 *
 * La cura è un posto solo che risponde alla domanda, con TRE risposte invece di due: non serve ·
 * questa fascia · non-valida. Prima la terza non esisteva e ripiegava sulla peggiore.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { join } from 'node:path';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import {
  APERTURA_EXPRESS,
  CHIUSURA_EXPRESS,
  ETICHETTA_ADESSO,
  FASCE_DI_DOMANI,
  FASCE_DI_OGGI,
  consegnaScelta,
  etichettaPerLOrdine,
  expressSiPuo,
  fasceAncoraPossibili,
  fasciaDiPartenzaOggi,
  giornoDiPartenza,
  oggiSiPuoAncora,
  rigaQuandoArriva,
  siPuoConfermare,
} from '@/lib/quando-arriva';

// R11-005 — La cassa montata per davvero (il montaggio e il finto sono quelli di
// riparazione-r22-veloce-l-invio-rilegge-l-ora): il caso «la fascia si ricontrolla anche AL MOMENTO
// di ordinare» preme «Ordina» e guarda se l'ordine parte, invece di cercare frasi nel sorgente.
const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
    },
  }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const GRUPPI = {
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [FILONE] }],
  orphans: [],
  stockIssues: [],
  variantIssues: [],
  prezziCambiati: [],
};
const FORM = { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' };

let rispondiAllaVeloce: (esito: unknown) => void = () => undefined;
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  const esito = await new Promise<unknown>((r) => {
    rispondiAllaVeloce = r;
  });
  return { ok: true, json: async () => esito };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  rispondiAllaVeloce = () => undefined;
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** La cassa di Maria aperta nell'istante detto, sul telefono col fuso detto, con la bozza già rimessa. */
async function cassa(a: { fuso: string; istanteUtc: string; bozza: Record<string, unknown>; veloce: unknown }) {
  process.env.TZ = a.fuso;
  // Si finge l'intervallo: il selettore e la cassa NON ridisegnano da soli col passare del tempo.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(a.istanteUtc));
  localStorage.setItem('cart', JSON.stringify(GRUPPI.groups.flatMap((g) => g.items)));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({ form: FORM, metodoPagamento: 'cod', ...a.bozza }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes(FILONE.id) ? GRUPPI : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  rispondiAllaVeloce(a.veloce);
  await assesta();
  const s = schermo;
  return {
    tessera: (nome: string) => s.radice.querySelector<HTMLButtonElement>(`button[aria-label^="${nome},"]`),
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    /** L'orologio va avanti fino all'istante detto, senza che la pagina ridisegni; poi si preme «Ordina». */
    ordinaAlle: async (istanteUtc: string) => {
      vi.setSystemTime(new Date(istanteUtc));
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      return (globale.__MUTAZIONI__ as unknown[]).length;
    },
  };
}

// Giovedì 29/10/2026, ora solare (Roma = UTC+1, Londra = UTC).
const ALLE_19_55_DI_ROMA = '2026-10-29T18:55:00Z';
const ALLE_20_05_DI_ROMA = '2026-10-29T19:05:00Z';
const ALLE_20_55_DI_ROMA = '2026-10-29T19:55:00Z';
const ALLE_21_05_DI_ROMA = '2026-10-29T20:05:00Z';

const OGGI_PRIMA = FASCE_DI_OGGI[4].etichetta;   // «Oggi · 16:30–18:00» (30/10, ondata 22)
const OGGI_SECONDA = FASCE_DI_OGGI[6].etichetta; // «Oggi · 19:30–21:00»
const DOMANI = FASCE_DI_DOMANI[0];

const base = {
  giorno: 'today' as const,
  ora: 10,
  fasciaOggi: OGGI_PRIMA,
  fasciaDomani: DOMANI,
  ritiroInNegozio: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// ① Quali fasce si possono ancora scegliere.
// ─────────────────────────────────────────────────────────────────────────────

describe('le fasce ancora possibili', () => {
  it('di mattina ci sono tutt\'e due', () => {
    expect(fasceAncoraPossibili(10)).toEqual(FASCE_DI_OGGI.slice(1).map((f) => f.etichetta));
  });

  it('una fascia vale finché non è FINITA, non finché non è cominciata', () => {
    // Alle 16 «15:00–18:00» è in corso: si può ancora ricevere dentro.
    expect(fasceAncoraPossibili(17)).toContain(OGGI_PRIMA);
    // Alle 18 quella è finita, resta la sera.
    expect(fasceAncoraPossibili(18)).not.toContain(OGGI_PRIMA);
    expect(fasceAncoraPossibili(18)).toContain(OGGI_SECONDA);
  });

  it('IL CASO: dalle 21 in poi per oggi non resta niente', () => {
    expect(fasceAncoraPossibili(20)).toEqual([OGGI_SECONDA]);
    expect(fasceAncoraPossibili(21)).toEqual([]);
    expect(fasceAncoraPossibili(23)).toEqual([]);
    expect(oggiSiPuoAncora(21)).toBe(false);
    expect(oggiSiPuoAncora(20)).toBe(true);
  });

  it('a mezzanotte e alle sette del mattino le fasce del pomeriggio ci sono ancora', () => {
    // Non è un dettaglio: alle 00:30 «oggi» è il giorno nuovo, e il pomeriggio deve arrivare.
    expect(oggiSiPuoAncora(0)).toBe(true);
    expect(oggiSiPuoAncora(7)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Da dove si parte: mai da un giorno che non si può scegliere.
// ─────────────────────────────────────────────────────────────────────────────

describe('il giorno di partenza', () => {
  it('finché ci sono fasce si parte da oggi', () => {
    expect(giornoDiPartenza(10)).toBe('today');
    expect(giornoDiPartenza(19)).toBe('today');
  });

  it('IL CASO: dalle 20 si parte da domani, non da un oggi impossibile', () => {
    expect(giornoDiPartenza(21)).toBe('tomorrow');
    expect(giornoDiPartenza(22)).toBe('tomorrow');
  });

  it('la fascia di partenza è la prima ANCORA possibile, e a fine giornata è «nessuna»', () => {
    expect(fasciaDiPartenzaOggi(10)).toBe('Oggi · 9:00–11:00');
    expect(fasciaDiPartenzaOggi(18)).toBe('Oggi · 18:00–19:30');
    // Prima qui ripiegava su OGGI_PRIMA — cioè su un orario passato.
    expect(fasciaDiPartenzaOggi(21)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ Le tre risposte, e il freno che mancava.
// ─────────────────────────────────────────────────────────────────────────────

describe('cosa si scrive sull\'ordine', () => {
  it('IL CASO: alle 21:40 su «oggi» la risposta è NON-VALIDA, e l\'ordine non parte', () => {
    const c = consegnaScelta({ ...base, ora: 21, fasciaOggi: OGGI_PRIMA });
    expect(c.tipo).toBe('non-valida');
    expect(siPuoConfermare(c)).toBe(false);
    expect(etichettaPerLOrdine(c)).toBeNull();
  });

  it('una fascia di oggi già passata non passa, nemmeno se ce n\'è un\'altra buona', () => {
    // Alle 19 «15:00–18:00» è finita: sceglierla è un appuntamento nel passato.
    const c = consegnaScelta({ ...base, ora: 19, fasciaOggi: OGGI_PRIMA });
    expect(c.tipo).toBe('non-valida');
    // Ma la sera è ancora buona.
    expect(consegnaScelta({ ...base, ora: 19, fasciaOggi: OGGI_SECONDA })).toEqual({
      tipo: 'scelta', etichetta: OGGI_SECONDA,
    });
  });

  it('una fascia buona passa e finisce sull\'ordine', () => {
    expect(consegnaScelta({ ...base, ora: 10 })).toEqual({ tipo: 'scelta', etichetta: OGGI_PRIMA });
    expect(etichettaPerLOrdine(consegnaScelta({ ...base, ora: 10 }))).toBe(OGGI_PRIMA);
  });

  it('«non serve» e «non valida» NON sono la stessa cosa, e prima lo erano', () => {
    // Tutt'e due finivano in un `null`, cioè in un ordine spedito senza fascia.
    const ritiro = consegnaScelta({ ...base, ritiroInNegozio: true, ora: 21 });
    const passata = consegnaScelta({ ...base, ora: 21 });
    expect(etichettaPerLOrdine(ritiro)).toBeNull();
    expect(etichettaPerLOrdine(passata)).toBeNull();
    // …e qui si separano: il ritiro si conferma, l'appuntamento passato no.
    expect(siPuoConfermare(ritiro)).toBe(true);
    expect(siPuoConfermare(passata)).toBe(false);
  });

  it('il ritiro in negozio vince su tutto: non gli serve nessuna fascia', () => {
    for (const giorno of ['now', 'today', 'tomorrow'] as const) {
      expect(consegnaScelta({ ...base, giorno, ora: 3, ritiroInNegozio: true }).tipo).toBe('non-serve');
    }
  });

  it('domani è buono a qualunque ora, anche di notte', () => {
    expect(consegnaScelta({ ...base, giorno: 'tomorrow', ora: 2 })).toEqual({
      tipo: 'scelta', etichetta: DOMANI,
    });
  });

  it('una fascia di domani inventata non passa', () => {
    const c = consegnaScelta({ ...base, giorno: 'tomorrow', fasciaDomani: 'Domani · alle 4 del mattino' });
    expect(c.tipo).toBe('non-valida');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ L'express, e la finestra in cui un rider c'è davvero.
// ─────────────────────────────────────────────────────────────────────────────

describe('la consegna immediata', () => {
  it('dentro la finestra si può, fuori no', () => {
    expect(expressSiPuo(APERTURA_EXPRESS)).toBe(true);
    expect(expressSiPuo(CHIUSURA_EXPRESS - 1)).toBe(true);
    expect(expressSiPuo(APERTURA_EXPRESS - 1)).toBe(false);
    expect(expressSiPuo(CHIUSURA_EXPRESS)).toBe(false);
  });

  it('fuori finestra «Adesso» è non-valida, non una promessa', () => {
    const c = consegnaScelta({ ...base, giorno: 'now', ora: 23 });
    expect(c.tipo).toBe('non-valida');
    expect(siPuoConfermare(c)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ Una promessa sola, e una riga che ascolta la scelta.
// ─────────────────────────────────────────────────────────────────────────────

describe('la promessa scritta a video', () => {
  it('il numero dei minuti viene da dove è deciso, non riscritto a mano', () => {
    expect(ETICHETTA_ADESSO).toContain(EXPRESS_ETA_LABEL);
    // La forma vecchia: un secondo numero, diverso da quello di tutto il resto del sito.
    expect(ETICHETTA_ADESSO).not.toMatch(/30\s*[–-]\s*45/);
  });

  it('IL CASO ③: la riga segue la scelta invece di dire sempre «in 30-60 minuti»', () => {
    const domani = consegnaScelta({ ...base, giorno: 'tomorrow' });
    expect(rigaQuandoArriva(domani)).toBe(DOMANI);
    expect(rigaQuandoArriva(domani)).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('su «Adesso» la riga dice i minuti, e sono gli stessi di tutto il sito', () => {
    const adesso = consegnaScelta({ ...base, giorno: 'now', ora: 10 });
    expect(rigaQuandoArriva(adesso)).toContain(EXPRESS_ETA_LABEL);
  });

  it('su non-valida la riga dice cosa non va e cosa fare, non un orario', () => {
    const c = consegnaScelta({ ...base, ora: 21 });
    const riga = rigaQuandoArriva(c);
    expect(riga).toMatch(/Domani/);
    expect(riga).not.toContain(EXPRESS_ETA_LABEL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ Gli invarianti sui file veri.
// ─────────────────────────────────────────────────────────────────────────────

describe('gli invarianti sul checkout vero', () => {
  const radice = process.cwd();
  const senzaCommenti = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
  const pickerGrezzo = readFileSync(join(radice, 'components/checkout/DeliverySlotPicker.tsx'), 'utf8');
  const checkoutGrezzo = readFileSync(join(radice, 'app/checkout/page.tsx'), 'utf8');
  const picker = senzaCommenti(pickerGrezzo);
  const checkout = senzaCommenti(checkoutGrezzo);

  it('nessun tempo di consegna DIVERSO da quello deciso — nemmeno in un commento', () => {
    // Il commento in cima al selettore diceva «Adesso (express ~30–45 min)», e la
    // prima stesura di questa prova non lo vedeva perché spogliava i commenti.
    // Un numero vecchio lasciato in un commento è il posto da cui il prossimo lo
    // ricopia: è lì che il difetto rinasce.
    //
    // ⚠️ E il metro NON è «non nominare i minuti»: prima lo era, e chiedeva di
    // cancellare la riga in cui è scritta la decisione di Nicola del 21/8 — cioè
    // di perdere il motivo per cui quel numero è quello. Il difetto è un numero
    // DIVERSO da quello deciso, non il numero.
    for (const [nome, src] of [['il selettore', pickerGrezzo], ['il checkout', checkoutGrezzo]] as const) {
      const intervalli = [...src.matchAll(/(\d+)\s*[–-]\s*(\d+)\s*min/gi)];
      for (const [testo, da, a] of intervalli) {
        expect(
          `${da}-${a}`,
          `${nome} promette «${testo.trim()}», che non è la promessa decisa (${EXPRESS_ETA_LABEL})`,
        ).toBe(EXPRESS_ETA_LABEL.replace(' min', ''));
      }
    }
  });

  it('la mattonella «Oggi» si spegne quando per oggi non c\'è più niente', () => {
    // Prima si disabilitava solo «Adesso»: «Oggi» restava premibile a mezzanotte.
    expect(picker).toMatch(/disabled=\{!oggiPossibile\}/);
  });

  it('e il giorno si SPOSTA a domani: spegnere la mattonella non basta', () => {
    // Il difetto ① viveva qui: `if (todayTimes.length === 0) return`. Un'uscita
    // silenziosa lasciava il giorno su "oggi" con dentro una fascia passata.
    // Spegnere solo la mattonella non lo cura: chi era già su "oggi" ci resta.
    expect(picker, 'l\'effetto torna a uscire senza spostare il giorno')
      .toMatch(/if\s*\(!oggiPossibile\)\s*\{[^}]*?onDayChange\('tomorrow'\)/);
  });

  it('il selettore non decide più da solo: chiede al modulo', () => {
    expect(picker).toMatch(/fasceAncoraPossibili\(/);
    expect(picker).not.toMatch(/function todayTimesAvailable/);
  });

  it('la fascia di partenza non ripiega più su una passata', () => {
    // La forma malata, esatta: `avail[0] ?? TODAY_SLOTS[0].label`.
    expect(picker).not.toMatch(/\?\?\s*TODAY_SLOTS\[0\]/);
    expect(checkout).toMatch(/giornoDiPartenza\(/);
  });

  it('la conferma passa dal freno, e l\'ordine parte dall\'etichetta decisa dal modulo', () => {
    expect(checkout).toMatch(/siPuoConfermare\(/);
    expect(checkout).toMatch(/etichettaPerLOrdine\(/);
    // La forma vecchia: la stringa costruita a mano dalle tre variabili di stato.
    expect(checkout).not.toMatch(/resolveSlotLabel\(/);
  });

  it('IL FRENO È ANCHE TIRATO: tutt\'e due i pulsanti di conferma lo leggono', () => {
    // Calcolare il freno e non applicarlo è la stessa malattia di legare un
    // errore senza guardarlo: a rileggere sembra a posto, e non ferma niente.
    // I pulsanti sono due — la barra del telefono e il riepilogo del desktop —
    // e uno solo dei due lascia la porta aperta sull'altro schermo.
    //
    // 6/9/2026 — Questa prova contava due `disabled={…}` con dentro scritto
    // `consegnaConfermabile`, cioè pretendeva che la condizione fosse
    // RICOPIATA nei due punti. Era proprio quella copia a far separare i due
    // pulsanti: sul telefono si spegneva senza dire perché, sul computer no.
    // Adesso il motivo del blocco si chiama `ordineBloccato` ed è scritto una
    // volta sola; la prova segue il freno fino ai due pulsanti invece di
    // contare le copie. Chiede di più, non di meno.
    const freno = checkout.match(/const ordineBloccato\s*=\s*[^;]+;/);
    expect(freno?.[0], 'il freno non esiste più, o non guarda la fascia di consegna')
      .toContain('!consegnaConfermabile');

    // ① il riepilogo di fianco (computer)
    expect(checkout, 'il pulsante del computer non legge il freno')
      .toContain('disabled={ordineBloccato}');
    // ② la barra incollata in fondo (telefono): resta premibile e DICHIARA il
    //    blocco, invece di spegnersi muta.
    // Ancora su codice vero e non su un commento: qui i commenti sono gia' via.
    // `fondoDellaBarra` la usa solo la barra incollata in fondo, quella del telefono.
    const barraDelTelefono = checkout.slice(checkout.indexOf('fondoDellaBarra('));
    expect(barraDelTelefono, 'il pulsante del telefono non legge il freno')
      .toContain('aria-disabled={ordineBloccato || isCheckingOut}');
  });

  it('la riga sotto le mattonelle non è più un testo fisso', () => {
    // ⚠️ NON basta che il file chiami `rigaQuandoArriva`: da quando la chiama
    // anche l'invio, «il file la chiama» ha smesso di provare che la RIGA la usi.
    // Se ne è accorta una mutazione che prima era rossa ed è tornata verde: è il
    // motivo per cui ogni mutazione si riprova dopo ogni aggiunta, non una volta.
    // R29-012 — il titolo del riquadro è la costante del nome della consegna.
    const titolo = checkout.indexOf('>{VOCE_CONSEGNA}</p>');
    expect(titolo, 'il riquadro della consegna non c è più').toBeGreaterThan(0);
    const riga = checkout.slice(titolo);
    expect(riga.slice(0, 400), 'la riga sotto le mattonelle torna un testo fisso')
      .toMatch(/rigaQuandoArriva\(consegna\)/);
  });

  it('la fascia si ricontrolla anche AL MOMENTO di ordinare, non solo mentre si disegna', async () => {
    // Chi apre il checkout alle 19:55 e preme «Ordina» alle 20:05 non ha
    // ridisegnato niente: il pulsante è ancora acceso da prima. Un vincolo che
    // dipende dall'orologio va riletto nell'istante in cui conta.
    // R11-005 — Prima erano tre frasi cercate nel testo di handleSubmit; adesso la cassa si monta e si preme «Ordina».
    // ① fascia di oggi scelta alle 19:55 e «Ordina» alle 20:05 senza ridisegno: nessuna chiamata alla rotta d'ordine
    const oggi = await cassa({
      fuso: 'Europe/Rome',
      istanteUtc: ALLE_19_55_DI_ROMA,
      bozza: { giorno: 'today', fasciaOggi: 'Oggi · 19:30–21:00', sceltaIl: Date.parse(ALLE_19_55_DI_ROMA) },
      veloce: { possibile: false },
    });
    expect(oggi.fascia(), 'la bozza non ha rimesso la fascia di oggi: la prova non misurerebbe niente').toBe('Oggi · 19:30–21:00');
    expect(await oggi.ordinaAlle(ALLE_20_05_DI_ROMA), 'alle 20:05 la fascia 19:30–21:00 non si può più: l\'invio non la ricontrolla e l\'ordine è partito').toBe(0);
    // ② lo stesso caso dice al cliente che la fascia è passata
    expect(avvisi.errori.join(' · '), 'l\'invio non frena e non dice perché').toMatch(/Per oggi non ci sono più fasce/);
    schermo?.smonta();
    schermo = null;
    avvisi.errori.length = 0;
    // ③ 30/10/2026 (ondata 18) — L'ora di Roma, come le rotte che rifiutano: non quella del telefono.
    // Telefono a Londra alle 20:05 (a Roma le 21:05) con «Adesso»: l'ordine non parte.
    const londra = await cassa({
      fuso: 'Europe/London',
      istanteUtc: ALLE_20_55_DI_ROMA,
      bozza: { giorno: 'now' },
      veloce: { possibile: true },
    });
    expect(londra.tessera('Adesso')?.getAttribute('aria-pressed'), '«Adesso» non è scelta: la prova non misurerebbe niente').toBe('true');
    expect(await londra.ordinaAlle(ALLE_21_05_DI_ROMA), 'a Roma sono le 21:05: l\'invio non rilegge l\'ora di Roma e l\'ordine è partito').toBe(0);
  }, 60_000);
});
