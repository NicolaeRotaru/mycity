/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * R71 — LE PAGINE PUBBLICHE DICONO COME TORNANO DAVVERO I CONTANTI, CON LE STESSE PAROLE.
 *
 * Decisione di Nicola del 17/10/2026 («Semplifica»): chi ha pagato in contanti riavrà sempre i
 * soldi con un bonifico fatto a mano; l'IBAN lo chiede l'email del rimborso e il cliente lo manda
 * rispondendo. Non c'è più una scelta del credito, un campo IBAN nel modulo di reso, una lista dei
 * bonifici o una cancellazione dell'account che aspetta il bonifico.
 *
 * Prima i testi dicevano tre cose diverse: «il rimborso arriva come credito MyCity… se preferisci il
 * bonifico, scrivici» (il credito d'ufficio, cioè R71), poi «scegli tu, nella richiesta di reso… indichi
 * l'IBAN». La FAQ prometteva «entro 14 giorni dalla ricezione del prodotto», mentre per il Codice del
 * Consumo (art. 56) i 14 giorni partono dal recesso; e diceva che cancellare l'account «rimuove tutti i
 * tuoi dati», mentre la riga dei conti degli ordini resta 10 anni.
 *
 * La prova MONTA le pagine vere — Resi, FAQ (aprendo le domande come farebbe una persona), Termini,
 * informativa e impostazioni — e legge quello che legge il cliente.
 *
 * Collaudo del 17/10 — due frasi nuove erano false o si contraddicevano. La FAQ diceva «non ti
 * chiediamo l'IBAN in nessun modulo del sito e nel nostro database non c'è un campo per l'IBAN»,
 * ma il modulo per diventare venditore l'IBAN degli incassi lo chiede e lo salva: la frase vale per
 * chi compra e per l'IBAN del rimborso, come la dice l'informativa. E FAQ e Resi contavano i 14
 * giorni dal recesso mentre i Termini §7, il contratto, li contavano ancora dalla ricezione della
 * merce: due scadenze per lo stesso rimborso. Adesso le tre pagine dicono la stessa, e la prova le
 * mette una accanto all'altra.
 *
 * ⚪ Che le parole dei Termini e dell'informativa vadano bene per la legge non lo dice una prova: lo
 * dice il legale, prima dell'unione.
 */

let Resi: ComponentType<Record<string, unknown>>;
let Faq: ComponentType<Record<string, unknown>>;
let Termini: ComponentType<Record<string, unknown>>;
let Informativa: ComponentType<Record<string, unknown>>;
let Impostazioni: ComponentType<Record<string, unknown>>;
let ModuloVenditore: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  const [r, f, t, i, s, v] = await Promise.all([
    monta('app/returns/page.tsx'),
    monta('app/faq/page.tsx'),
    monta('app/terms/page.tsx'),
    monta('app/privacy/page.tsx'),
    monta('app/profile/settings/page.tsx'),
    monta('components/SellerApplicationForm.tsx'),
  ]);
  Resi = r.default as ComponentType<Record<string, unknown>>;
  Faq = f.default as ComponentType<Record<string, unknown>>;
  Termini = t.default as ComponentType<Record<string, unknown>>;
  Informativa = i.default as ComponentType<Record<string, unknown>>;
  Impostazioni = s.default as ComponentType<Record<string, unknown>>;
  ModuloVenditore = v.default as ComponentType<Record<string, unknown>>;
}, 120000);

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  g.__UTENTE__ = { id: 'u1', email: 'giulia@esempio.it' };
  g.__RISPOSTA_SUPABASE__ = { data: [{ notif_order_updates: true, email_marketing: false }], error: null };
  // Le impostazioni chiedono se c'è una cancellazione in corso: qui no.
  g.fetch = async () =>
    new Response(JSON.stringify({ pending: false }), { status: 200, headers: { 'content-type': 'application/json' } });
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__UTENTE__;
  delete g.__RISPOSTA_SUPABASE__;
  document.body.innerHTML = '';
});

/** Il testo intero di una pagina montata. */
function testoDi(Pagina: ComponentType<Record<string, unknown>>): string {
  const s = accendi(Pagina);
  const testo = testoVisibile(s.radice);
  s.smonta();
  expect(testo.length, 'la pagina non è comparsa: la prova non sta guardando niente').toBeGreaterThan(200);
  return testo;
}

/** La risposta della FAQ come la legge chi apre la domanda, con i collegamenti che porta. */
function rispostaDellaFaq(domanda: string): { testo: string; collegamenti: string[] } {
  const s = accendi(Faq);
  const pulsante = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes(domanda));
  expect(pulsante, `la domanda «${domanda}» non c'è: la prova non sta guardando niente`).toBeTruthy();
  s.agisci(() => clicca(pulsante!));
  const risposta = pulsante!.parentElement!.querySelector('div');
  const testo = testoVisibile(risposta);
  const collegamenti = Array.from(risposta?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href') ?? '');
  s.smonta();
  expect(testo, `la risposta a «${domanda}» non si è aperta`).not.toBe('');
  return { testo, collegamenti };
}

/** Quello che dicevano i testi del credito d'ufficio e della scelta: nessuna pagina lo dice più. */
const PROMESSE_TOLTE = [
  /il rimborso arriva come credito MyCity/iu,
  /se preferisci il bonifico/iu,
  /scegli tu/iu,
  /Come vuoi il rimborso/iu,
  /nel modulo di reso/iu,
  /indichi l'IBAN/iu,
  /cancellazione aspetta/iu,
  /bonifico (è|risulti) fatto/iu,
];

function nonDiceLePromesseTolte(pagina: string, testo: string) {
  for (const promessa of PROMESSE_TOLTE) expect(testo, `${pagina} dice ancora ${promessa}`).not.toMatch(promessa);
}

describe('la pagina dei Resi', () => {
  it('IL CASO CHE ROMPEVA — i contanti tornano col bonifico, l IBAN si chiede per email, nessuna scelta', () => {
    const testo = testoDi(Resi);
    expect(testo).toContain(
      "Per gli ordini pagati alla consegna ti restituiamo i soldi con un bonifico sul tuo conto: l'IBAN te lo chiediamo per email quando parte il rimborso.",
    );
    expect(testo).toContain('La parte che avevi pagato con il credito MyCity torna come credito');
    nonDiceLePromesseTolte('/returns', testo);
  });

  it('i 14 giorni partono dal recesso, con le stesse parole della FAQ', () => {
    const testo = testoDi(Resi);
    expect(testo).toContain('entro 14 giorni da quando ci comunichi il recesso');
    expect(testo).not.toMatch(/dalla ricezione del prodotto/u);
    expect(rispostaDellaFaq('In quanto tempo ricevo il rimborso?').testo).toContain('Entro 14 giorni da quando ci comunichi il recesso');
  });
});

describe('le domande frequenti', () => {
  it('«In quanto tempo ricevo il rimborso?»: dal recesso, la carta sulla carta, i contanti col bonifico per email', () => {
    const { testo } = rispostaDellaFaq('In quanto tempo ricevo il rimborso?');
    expect(testo).toContain(
      "Entro 14 giorni da quando ci comunichi il recesso. Possiamo aspettare di avere indietro la merce, o la prova che l'hai spedita.",
    );
    expect(testo).toContain('Se hai pagato con la carta, il rimborso torna sulla carta.');
    expect(testo).toContain("ti restituiamo i soldi con un bonifico: ti scriviamo per email per chiederti l'IBAN");
    expect(testo).toContain('La parte pagata con il credito MyCity torna come credito.');
    expect(testo).not.toMatch(/dalla ricezione del prodotto/u);
    nonDiceLePromesseTolte('la FAQ sui tempi', testo);
  });

  it('IL CASO CHE ROMPEVA — «Il pagamento è sicuro?»: nessun modulo e nessun campo per l IBAN del rimborso, per chi compra', () => {
    // Controprova: un modulo del sito l'IBAN lo chiede davvero, quello per diventare venditore. Una
    // frase su «nessun modulo» che non dice per chi vale è falsa per chi vende.
    const v = accendi(ModuloVenditore, { onSubmit: () => {} });
    const etichette = Array.from(v.radice.querySelectorAll('label')).map((l) => testoVisibile(l));
    v.smonta();
    expect(etichette.length, 'il modulo del venditore non è comparso: la controprova non sta guardando niente').toBeGreaterThan(5);
    expect(etichette.some((e) => /IBAN/u.test(e)), 'il modulo del venditore non chiede l IBAN: la controprova non vale').toBe(true);

    const { testo, collegamenti } = rispostaDellaFaq('Il pagamento è sicuro?');
    expect(testo).toContain(
      "Se compri, non ti chiediamo l'IBAN in nessun modulo del sito e nel nostro database non c'è un campo per l'IBAN del rimborso",
    );
    expect(testo, 'la risposta dice «nessun modulo» per tutti, chi vende compreso').not.toMatch(
      /(?<!Se compri, non ti chiediamo l'IBAN )in nessun modulo/iu,
    );
    expect(testo, 'la risposta dice «nessun campo per l IBAN», mentre l IBAN di chi vende ha il suo').not.toMatch(
      /campo per l'IBAN(?! del rimborso)/iu,
    );
    expect(testo).toContain('te lo chiediamo per email e ce lo mandi rispondendo');
    // Il «non lo salviamo sul sito» era falso: chi lo scrive nei Contatti lascia un messaggio nel database.
    expect(testo).not.toMatch(/non lo salviamo/iu);
    expect(collegamenti, 'per il dove e il quanto la risposta non porta all informativa').toContain('/privacy');
  });

  it('IL CASO CHE ROMPEVA — «Come elimino il mio account?» non promette di togliere tutti i dati', () => {
    const { testo, collegamenti } = rispostaDellaFaq('Come elimino il mio account?');
    expect(testo, 'la riga dei conti resta 10 anni, e la FAQ prometteva il contrario').not.toMatch(/rimuove tutti i tuoi dati/iu);
    expect(testo).toContain('Togliamo il profilo, gli indirizzi e le preferenze.');
    expect(testo).toContain('Resta la riga dei conti dei tuoi ordini, senza il tuo nome, per i 10 anni che chiede la legge.');
    // L'avviso del bonifico porta l'email del cliente e la cancellazione non lo tocca, apposta: la
    // FAQ lo dice, come l'informativa, anche a bonifico già pagato (la prova
    // chi-cancella-l-account-sa-che-l-avviso-del-bonifico-resta fa girare rotte, cancellazione e
    // potature vere, poi legge FAQ e impostazioni).
    expect(testo).toContain(
      "Se ti è stato approvato un rimborso con bonifico, già pagato o ancora da pagare, resta anche l'avviso interno con la tua email, finché non lo cancelliamo noi: serve a chi fa il bonifico per scriverti e pagarti.",
    );
    expect(collegamenti).toEqual(expect.arrayContaining(['/profile/settings', '/privacy']));
  });
});

describe('la scadenza del rimborso', () => {
  it('IL CASO CHE ROMPEVA — Termini §7, FAQ e Resi contano i 14 giorni del rimborso dallo stesso giorno', () => {
    const s = accendi(Termini);
    const termini = testoVisibile(s.radice.querySelector('#recesso'));
    s.smonta();
    expect(termini, 'il §7 non è comparso').toContain('Diritto di recesso');
    const testi: Record<string, string> = {
      'i Termini §7': termini,
      'la FAQ': rispostaDellaFaq('In quanto tempo ricevo il rimborso?').testo,
      'la pagina Resi': testoDi(Resi),
    };

    const DA_QUANDO = /(?:rimborso (?:è effettuato|avviene) entro|\bEntro) 14 giorni (da[^,.]*)/gu;
    const daQuando: Record<string, string[]> = {};
    for (const [dove, testo] of Object.entries(testi)) {
      daQuando[dove] = Array.from(testo.matchAll(DA_QUANDO), (m) => m[1].trim());
      expect(daQuando[dove].length, `${dove}: non trovo da quando partono i 14 giorni del rimborso`).toBeGreaterThan(0);
      expect(testo, `${dove} conta i 14 giorni dalla ricezione`).not.toMatch(/14 giorni dalla ricezione/u);
      expect(testo, `${dove} non dice che possiamo aspettare la merce o la prova della spedizione`).toContain(
        "Possiamo aspettare di avere indietro la merce, o la prova che l'hai spedita.",
      );
    }
    expect(
      new Set(Object.values(daQuando).flat()),
      `due testi pubblici danno due scadenze diverse per lo stesso rimborso: ${JSON.stringify(daQuando)}`,
    ).toEqual(new Set(['da quando ci comunichi il recesso']));

    // Collaudo del 17/10, secondo giro — la ricerca qui sopra riconosce due modi di scrivere la
    // scadenza. «Ti rimborsiamo entro 14 giorni dal ricevimento della merce restituita.», aggiunta al
    // §7, rimetteva due scadenze nel contratto e passava. Adesso si guarda ogni parola di tempo dei
    // tre testi (un numero di giorni, settimane o mesi; entro, dopo, appena, subito, quando; ricevere,
    // ricezione): ognuna deve stare dentro una frase che la prova conosce. Una frase di tempo nuova fa
    // diventare rossa la prova finché qualcuno non la legge: se è una scadenza del rimborso, deve
    // contare da quando ci comunichi il recesso, come le altre.
    for (const [dove, testo] of Object.entries(testi)) {
      const coperto = new Array<boolean>(testo.length).fill(false);
      const minuscolo = testo.toLowerCase();
      for (const frase of FRASI_DI_TEMPO_CONOSCIUTE) {
        const f = frase.toLowerCase();
        for (let i = minuscolo.indexOf(f); i >= 0; i = minuscolo.indexOf(f, i + 1)) coperto.fill(true, i, i + f.length);
      }
      const sconosciute = Array.from(testo.matchAll(PAROLE_DI_TEMPO))
        .filter((m) => !coperto[m.index!])
        .map((m) => `«${m[0]}» in «…${testo.slice(Math.max(0, m.index! - 60), m.index! + 60)}…»`);
      expect(sconosciute, `${dove} dice un tempo che la prova non conosce: se è la scadenza del rimborso, contala da quando ci comunichi il recesso`).toEqual([]);
    }
  }, 60000);
});

/** Le parole che dicono un tempo: una scadenza nuova del rimborso ne porta almeno una. */
const PAROLE_DI_TEMPO =
  /\b(?:\d+|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|quindici|quattordici|trenta)\s+(?:giorn\w*|settiman\w*|mes[ei]|or[ae]|ann[oi])\b|\b(?:entro|dopo|appena|subito|quando|immediatamente|settimana)\b|\bricev\w*|\bricezion\w*/giu;

/**
 * Le frasi di tempo dei Termini §7, della FAQ sui tempi e della pagina Resi, una per una. Solo la
 * prima è la scadenza del rimborso; le altre dicono il tempo per recedere, per spedire, la garanzia,
 * o quando ti chiediamo l'IBAN, e nessuna dà un'altra scadenza per i soldi.
 */
const FRASI_DI_TEMPO_CONOSCIUTE = [
  'entro 14 giorni da quando ci comunichi il recesso',
  // Termini §7
  'ha diritto di recedere dal contratto entro 14 giorni dalla consegna',
  'prodotti sigillati (per igiene) aperti dopo la consegna, beni che dopo la consegna risultino mescolati',
  "dopo l'avvio dell'esecuzione",
  'Ordinato il ................ / Ricevuto il',
  // FAQ
  "e il bonifico lo facciamo appena ce lo mandi",
  // Resi
  'Hai 14 giorni di tempo per ripensarci',
  '14 giorni di diritto di recesso',
  'Il venditore riceve la richiesta',
  'hai 14 giorni dalla consegna per restituire qualsiasi prodotto',
  'Spedisci il pacco entro 14 giorni dalla richiesta',
  'Al ricevimento, il venditore verifica il prodotto e procede al rimborso',
  "l'IBAN te lo chiediamo per email quando parte il rimborso",
  'richiesta inviata, ricevuta, approvata, rimborsata',
  'garanzia legale di 24 mesi',
  'la garanzia è di 12 mesi',
];

describe('i Termini, §7', () => {
  it('dopo lo stesso mezzo di pagamento: i contanti col bonifico, senza costi, sul conto indicato rispondendo all email', () => {
    const s = accendi(Termini);
    const recesso = testoVisibile(s.radice.querySelector('#recesso'));
    s.smonta();
    expect(recesso, 'il §7 non è comparso').toContain('Diritto di recesso');
    expect(recesso).toContain(
      'Per gli ordini pagati in contanti alla consegna, il rimborso avviene con bonifico bancario, senza costi a tuo carico, sul conto che ci indichi rispondendo alla nostra email.',
    );
    expect(recesso).toContain('La parte pagata con il credito MyCity torna come credito MyCity.');
    nonDiceLePromesseTolte('i Termini §7', recesso);
  });
});

describe('l informativa', () => {
  it('nessun modulo e nessun campo per l IBAN del rimborso, nella voce di chi compra; il «non lo salviamo» non sta senza l eccezione dei Contatti', () => {
    const testo = testoDi(Informativa);
    // La frase sta nella voce dei dati per il rimborso di chi compra: è quella che le dà il confine.
    const voce = testo.slice(testo.indexOf('Dati per il rimborso con bonifico (Acquirenti'));
    expect(voce, 'la voce dei dati per il rimborso non c è più').not.toBe(testo.slice(-1));
    expect(voce).toMatch(
      /^Dati per il rimborso con bonifico \(Acquirenti[^:]*: [^]*?Non ti chiediamo l'IBAN in nessun modulo del sito e nel nostro database non c'è un campo per l'IBAN del rimborso/u,
    );
    expect(testo).toContain('rispondendo all\'email che ti scriviamo quando parte il rimborso');
    expect(testo).toContain("Non scrivere l'IBAN nel modulo Contatti: ti rispondiamo per email.");
    expect(testo, 'l informativa promette che l IBAN non sta mai nel database: un messaggio dai Contatti ci resta').not.toMatch(
      /non lo salviamo nel nostro database/iu,
    );
    nonDiceLePromesseTolte('l informativa', testo);
  });
});

describe('le impostazioni, prima di cancellare l account', () => {
  it('due frasi distinte: il reclamo aperto su qualunque ordine, e il reso aperto in contanti; nessuna attesa', async () => {
    const s = accendi(Impostazioni);
    await attendi();
    await attendi();
    const scheda = Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).trim() === 'Zona pericolosa');
    expect(scheda, 'la scheda «Zona pericolosa» non si trova: la pagina non è arrivata in fondo al caricamento').toBeTruthy();
    s.agisci(() => clicca(scheda!));
    const testo = testoVisibile(s.radice);
    s.smonta();

    expect(testo).toContain("Un reclamo ancora aperto, su qualunque ordine, si cancella insieme all'account: aspetta che si chiuda.");
    expect(testo).toContain(
      "Se hai un reso aperto su un ordine pagato alla consegna, dopo la cancellazione non abbiamo più il tuo indirizzo per chiederti l'IBAN.",
    );
    nonDiceLePromesseTolte('le impostazioni', testo);
  }, 60000);
});
