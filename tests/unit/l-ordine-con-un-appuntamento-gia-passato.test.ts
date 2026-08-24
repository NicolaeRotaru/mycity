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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

const OGGI_PRIMA = FASCE_DI_OGGI[0].etichetta;   // «In giornata · 15:00–18:00»
const OGGI_SECONDA = FASCE_DI_OGGI[1].etichetta; // «Stasera · 18:00–20:00»
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
    expect(fasceAncoraPossibili(10)).toEqual([OGGI_PRIMA, OGGI_SECONDA]);
  });

  it('una fascia vale finché non è FINITA, non finché non è cominciata', () => {
    // Alle 16 «15:00–18:00» è in corso: si può ancora ricevere dentro.
    expect(fasceAncoraPossibili(16)).toContain(OGGI_PRIMA);
    // Alle 18 quella è finita, resta la sera.
    expect(fasceAncoraPossibili(18)).toEqual([OGGI_SECONDA]);
  });

  it('IL CASO: dalle 20 in poi per oggi non resta niente', () => {
    expect(fasceAncoraPossibili(20)).toEqual([]);
    expect(fasceAncoraPossibili(21)).toEqual([]);
    expect(fasceAncoraPossibili(23)).toEqual([]);
    expect(oggiSiPuoAncora(20)).toBe(false);
    expect(oggiSiPuoAncora(19)).toBe(true);
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
    expect(giornoDiPartenza(20)).toBe('tomorrow');
    expect(giornoDiPartenza(22)).toBe('tomorrow');
  });

  it('la fascia di partenza è la prima ANCORA possibile, e a fine giornata è «nessuna»', () => {
    expect(fasciaDiPartenzaOggi(10)).toBe(OGGI_PRIMA);
    expect(fasciaDiPartenzaOggi(18)).toBe(OGGI_SECONDA);
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
      .toMatch(/if\s*\(!oggiPossibile\)\s*\{\s*onDayChange\('tomorrow'\)/);
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
    const bloccati = [...checkout.matchAll(/disabled=\{[^}]*\}/g)]
      .filter((m) => m[0].includes('consegnaConfermabile'));
    expect(bloccati.length, 'un pulsante di conferma non guarda la fascia').toBe(2);
  });

  it('la riga sotto le mattonelle non è più un testo fisso', () => {
    // ⚠️ NON basta che il file chiami `rigaQuandoArriva`: da quando la chiama
    // anche l'invio, «il file la chiama» ha smesso di provare che la RIGA la usi.
    // Se ne è accorta una mutazione che prima era rossa ed è tornata verde: è il
    // motivo per cui ogni mutazione si riprova dopo ogni aggiunta, non una volta.
    const riga = checkout.slice(checkout.indexOf('Consegna a domicilio'));
    expect(riga.slice(0, 400), 'la riga sotto le mattonelle torna un testo fisso')
      .toMatch(/rigaQuandoArriva\(consegna\)/);
  });

  it('la fascia si ricontrolla anche AL MOMENTO di ordinare, non solo mentre si disegna', () => {
    // Chi apre il checkout alle 19:55 e preme «Ordina» alle 20:05 non ha
    // ridisegnato niente: il pulsante è ancora acceso da prima. Un vincolo che
    // dipende dall'orologio va riletto nell'istante in cui conta.
    const invio = checkout.slice(checkout.indexOf('const handleSubmit'));
    expect(invio, 'l\'invio non ricontrolla la fascia').toMatch(/consegnaScelta\(/);
    expect(invio, 'l\'invio non rilegge l\'ora').toMatch(/ora: new Date\(\)\.getHours\(\)/);
    expect(invio, 'l\'invio non frena').toMatch(/if \(!siPuoConfermare\(/);
  });
});
