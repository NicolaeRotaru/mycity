/**
 * @vitest-environment jsdom
 */
/**
 * 8/9/2026 — L'ELENCO UTENTI SI FERMAVA A CINQUECENTO, LA RICERCA CERCAVA SOLO
 * LÌ DENTRO, E NON LO DICEVA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────
 * /admin/users scarica i cinquecento profili più recenti — un tetto messo
 * apposta, perché prima li leggeva tutti a ogni apertura. Poi filtrava e
 * cercava dentro quei cinquecento, e sotto il titolo scriveva la lunghezza
 * dell'elenco che aveva in mano chiamandola «risultati»:
 *
 *     sub={`${filtered.length} risultati`}
 *
 * Dal cinquecentunesimo iscritto in poi quella riga avrebbe detto «500
 * risultati» per sempre. Peggio: cercare l'email di un cliente iscritto sei
 * mesi prima non dava «non è fra i più recenti», dava ZERO RIGHE — e chi
 * guarda conclude che quella persona non esiste. Se sta rispondendo a una
 * richiesta di cancellazione dati, «non esiste» è la risposta sbagliata che si
 * paga in sanzione. Il file CSV ereditava lo stesso tetto, senza dirlo.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * ① A schermo: la pagina montata davvero, con cinquecento profili in mano e
 *    milleduecentoquaranta iscritti nel database, NON scrive «500 risultati» —
 *    scrive il numero vero e lo dichiara.
 * ② Che le tre scritte (sottotitolo, avviso, elenco vuoto) escono dalla stessa
 *    funzione, quindi non possono contraddirsi.
 * ③ Che la ricerca dichiara DOVE ha guardato: su tutti gli utenti, oppure solo
 *    nei profili in memoria quando il database non risponde.
 * ④ Che il filtro mandato al database non si fa spezzare da una virgola né
 *    allargare da un `%` scritti nella casella di ricerca.
 * ⑤ Che il file CSV monco si dichiara monco: prima riga e nome del file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  etichetteElenco, elencoTroncato, filtroRicercaProfili, idsDaContattiAuth,
  risultatiRicerca, unisciPerId, numeroItaliano, ambitoDellaRicerca, TETTO_UTENTI,
} from '@/lib/admin/elenco-utenti';
import {
  raccogliUtentiDaEsportare, raccoltaDallaRicerca, contenutoCsvUtenti,
  nomeFileUtenti, type UtenteDaEsportare,
} from '@/lib/admin/esporta-utenti';

const globale = globalThis as Record<string, unknown>;

/** Un profilo qualunque, come lo legge la pagina. */
function profilo(n: number) {
  return {
    id: `utente-${n}`, role: 'buyer', is_approved: true, approval_status: null,
    approval_requested_at: null, approved_at: null, rejection_reason: null,
    store_name: null, full_name: `Cliente ${n}`, phone: null, store_address: null,
    legal_first_name: null, legal_last_name: null, legal_fiscal_code: null,
    business_legal_name: null, business_vat_number: null, business_form: null,
    business_address: null, business_city: null, business_pec: null,
    created_at: '2026-09-01T09:00:00Z', email: `cliente${n}@piacenza.it`,
    auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
  };
}

/**
 * La pagina con `quanti` profili in mano e `totale` iscritti nel database.
 * Le risposte finte si smistano sulla chiave della lettura, come le smista
 * react-query: `{}` è l'elenco, `{conteggio}` è il conto vero.
 */
function conElenco(quanti: number, totale: number | null) {
  const righe = Array.from({ length: quanti }, (_, i) => profilo(i + 1));
  globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
    const chiave = (o.queryKey ?? []) as unknown[];
    if (chiave[3] === 'kyc') return { legal_fiscal_code: null, business_vat_number: null };
    const filtri = (chiave[2] ?? {}) as Record<string, unknown>;
    if (filtri.conteggio === 'totale') return totale;
    if (typeof filtri.cerca === 'string') return undefined;
    return righe;
  };
  return righe;
}

async function apriLaPagina() {
  const mod = await monta('app/admin/users/page.tsx');
  return accendi(mod.default as ComponentType);
}

/** Scrivere in un campo controllato da React, come ci scrive una persona. */
function scriviNelCampo(campo: HTMLInputElement, valore: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Il tempo che la casella aspetta prima di disturbare il database. */
async function passaIlTempoDellaRicerca(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

afterEach(() => {
  delete globale.__DATI_QUERY__;
  document.body.innerHTML = '';
});

describe('a schermo: il sottotitolo dell’elenco utenti', () => {
  it('con più iscritti del tetto NON chiama «risultati» i cinquecento che ha in mano', async () => {
    conElenco(TETTO_UTENTI, 1240);
    const s = await apriLaPagina();
    const testo = s.radice.textContent ?? '';

    expect(
      testo,
      'la pagina chiama ancora «risultati» le righe che ha in mano: al 501esimo iscritto direbbe «500 risultati» per sempre',
    ).not.toContain('500 risultati');
    expect(testo, 'il numero vero degli iscritti non compare da nessuna parte').toContain('1.240');
    expect(
      testo,
      'nessuno avverte che l’elenco si ferma ai più recenti e che per gli altri serve la ricerca',
    ).toContain('si ferma ai 500 iscritti più recenti');

    s.smonta();
  });

  it('quando ci stanno tutti non spaventa nessuno: nessun avviso, il numero e basta', async () => {
    conElenco(12, 12);
    const s = await apriLaPagina();
    const testo = s.radice.textContent ?? '';

    expect(testo).toContain('12 utenti');
    expect(testo, 'un avviso che non serve è rumore: qui non c’è niente da confessare')
      .not.toContain('si ferma ai');

    s.smonta();
  });

  it('cercando trova chi NON è fra i cinquecento che ha in mano', async () => {
    // I cinquecento in memoria sono tutti «Cliente N»: la signora iscritta sei
    // mesi fa non c'è, ed è il caso che prima dava zero righe in silenzio.
    const righe = Array.from({ length: TETTO_UTENTI }, (_, i) => profilo(i + 1));
    const vecchia = {
      ...profilo(9999), full_name: 'Gabriella Bertorelli',
      email: 'gabriella@piacenza.it', created_at: '2026-02-01T09:00:00Z',
    };
    globale.__DATI_QUERY__ = (o: { queryKey?: unknown[] }) => {
      const chiave = (o.queryKey ?? []) as unknown[];
      if (chiave[3] === 'kyc') return { legal_fiscal_code: null, business_vat_number: null };
      const filtri = (chiave[2] ?? {}) as Record<string, unknown>;
      if (filtri.conteggio === 'totale') return 1240;
      // La risposta del database alla ricerca: una riga che in memoria non c'è.
      if (typeof filtri.cerca === 'string' && filtri.cerca.length >= 2) {
        return { righe: [vecchia], troncato: false };
      }
      return righe;
    };

    const s = await apriLaPagina();
    expect(s.radice.textContent ?? '').not.toContain('Gabriella Bertorelli');

    const casella = s.radice.querySelector('input[type="search"]') as HTMLInputElement;
    expect(casella, 'la casella di ricerca non è a video: la prova girerebbe a vuoto').toBeTruthy();
    s.agisci(() => scriviNelCampo(casella, 'gabriella@piacenza.it'));
    await passaIlTempoDellaRicerca();

    const testo = s.radice.textContent ?? '';
    expect(
      testo,
      'la ricerca guarda ancora solo i profili già scaricati: chi si è iscritto prima resta invisibile',
    ).toContain('Gabriella Bertorelli');
    expect(testo).toContain('cercati su tutti gli utenti');

    s.smonta();
  });

  it('mentre sta ancora cercando non dice «non trovato»', async () => {
    conElenco(TETTO_UTENTI, 1240);
    const s = await apriLaPagina();
    const casella = s.radice.querySelector('input[type="search"]') as HTMLInputElement;

    // Si scrive e NON si aspetta: è la finestra in cui la vecchia pagina
    // mostrava già zero righe con l'aria di aver guardato dappertutto.
    s.agisci(() => scriviNelCampo(casella, 'gabriella@piacenza.it'));

    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Sto cercando');
    expect(
      testo,
      'una risposta che non è ancora arrivata non è un «non esiste»',
    ).not.toContain('Nessun utente corrisponde');

    s.smonta();
  });

  it('se il database non riesce a contare, lo dice: «non ho potuto contare», non zero', async () => {
    conElenco(TETTO_UTENTI, null);
    const s = await apriLaPagina();
    const testo = s.radice.textContent ?? '';

    expect(testo).toContain('non ho potuto contare');
    expect(testo).not.toContain('500 risultati');

    s.smonta();
  });
});

describe('le tre scritte escono insieme, quindi non si contraddicono', () => {
  const base = {
    caricati: TETTO_UTENTI, totale: 1240, tetto: TETTO_UTENTI,
    ricerca: '', ambito: 'nessuna' as const, filtro: 'all',
  };

  it('l’elenco tagliato dal tetto lo dichiara nel sottotitolo E nell’avviso', () => {
    const e = etichetteElenco({ ...base, mostrati: 500 });
    expect(e.sottotitolo).toBe('500 dei 500 iscritti più recenti · in tutto sono 1.240');
    expect(e.avviso).toContain('1.240');
    expect(e.avviso).toContain('ricerca');
  });

  it('cinquecento su cinquecento esistenti NON è un elenco tagliato', () => {
    expect(elencoTroncato({ caricati: 500, totale: 500, tetto: 500 })).toBe(false);
    expect(elencoTroncato({ caricati: 500, totale: 501, tetto: 500 })).toBe(true);
    // Senza conteggio non si può escludere: il tetto toccato vale come sospetto.
    expect(elencoTroncato({ caricati: 500, totale: null, tetto: 500 })).toBe(true);
  });

  it('il ruolo senza nessuno dice fra quanti ha guardato, e come trovare gli altri', () => {
    const e = etichetteElenco({ ...base, mostrati: 0, filtro: 'rider' });
    expect(e.vuoto).toContain('rider');
    expect(e.vuoto).toContain('500 iscritti più recenti');
    expect(e.vuoto).toContain('la ricerca guarda tutti gli utenti');
  });

  it('«nessun utente registrato» si dice solo se il database dice zero', () => {
    const e = etichetteElenco({ ...base, mostrati: 0, caricati: 0, totale: 0 });
    expect(e.vuoto).toBe('Nessun utente registrato sulla piattaforma.');
    expect(e.avviso).toBeNull();
  });
});

describe('la ricerca dichiara dove ha guardato', () => {
  const base = {
    mostrati: 0, caricati: TETTO_UTENTI, totale: 1240, tetto: TETTO_UTENTI,
    ricerca: 'vecchia@cliente.it', filtro: 'all',
  };

  it('cercato sul database e non trovato: «ho cercato su tutti», che è una risposta vera', () => {
    const e = etichetteElenco({ ...base, ambito: 'server' });
    expect(e.vuoto).toContain('Ho cercato su tutti');
    expect(e.vuoto).toContain('1.240');
    expect(e.avviso).toBeNull();
  });

  it('database muto: NON dice «non trovato», dice che ha guardato in un pezzo solo', () => {
    const e = etichetteElenco({ ...base, ambito: 'solo-caricati' });
    expect(
      e.vuoto,
      'senza questa frase chi guarda risponde «non è iscritta» a una richiesta di cancellazione dati',
    ).toContain('NON vuol dire');
    expect(e.vuoto).toContain('500 profili più recenti');
    expect(e.avviso).toContain('non ha risposto');
  });

  it('troppi risultati: dice che sono i primi, non «sono questi»', () => {
    const e = etichetteElenco({ ...base, mostrati: 200, ambito: 'server', ricercaTroncata: true });
    expect(e.sottotitolo).toContain('sono i primi 200');
    expect(e.avviso).toContain('restringere');
  });

  it('mentre la risposta non c’è, non dice né trovato né non trovato', () => {
    const e = etichetteElenco({ ...base, ambito: 'in-corso' });
    expect(e.vuoto).toContain('Sto cercando');
    expect(e.avviso).toBeNull();
  });
});

describe('quale dei quattro stati è, in ogni momento', () => {
  const stato = (s: Partial<Parameters<typeof ambitoDellaRicerca>[0]>) => ambitoDellaRicerca({
    termineScritto: 'rossi', termineCercato: 'rossi', haRisposta: true, caduta: false, ...s,
  });

  it('casella vuota o troppo corta: nessuna ricerca in corso', () => {
    expect(stato({ termineScritto: '', termineCercato: '' }).ambito).toBe('nessuna');
    expect(stato({ termineScritto: 'r', termineCercato: 'r' }).ambito).toBe('nessuna');
  });

  it('appena scritto, prima che la domanda parta: sta cercando', () => {
    const s = stato({ termineScritto: 'rossini', termineCercato: 'rossi' });
    expect(s.ambito).toBe('in-corso');
    expect(s.mostrato, 'si mostra quello che ha in mano chi cerca, non quello vecchio').toBe('rossini');
  });

  it('domanda partita, risposta non ancora arrivata: sta cercando, non «non trovato»', () => {
    expect(stato({ haRisposta: false }).ambito).toBe('in-corso');
  });

  it('la lettura cade: si dichiara che si guarda solo in memoria', () => {
    expect(stato({ caduta: true, haRisposta: false }).ambito).toBe('solo-caricati');
  });

  it('risposta arrivata: allora sì, si è cercato su tutti', () => {
    expect(stato({}).ambito).toBe('server');
  });
});

describe('il filtro che va al database', () => {
  it('cerca su nome, negozio, ragione sociale e telefono', () => {
    const f = filtroRicercaProfili('rossi') ?? '';
    expect(f).toContain('full_name.ilike.%rossi%');
    expect(f).toContain('store_name.ilike.%rossi%');
    expect(f).toContain('business_legal_name.ilike.%rossi%');
    expect(f).toContain('phone.ilike.%rossi%');
  });

  it('una virgola nella casella non diventa una seconda condizione', () => {
    const condizioni = (filtroRicercaProfili('rossi,role.eq.admin') ?? '').split(',');
    expect(
      condizioni,
      'la virgola separa le condizioni: chi cerca potrebbe scriversene una sua',
    ).toHaveLength(5);
    for (const c of condizioni) {
      expect(c).toMatch(/^[a-z_]+\.ilike\.%[^,]*%$/);
    }
  });

  it('un «%» incollato dentro non fa uscire tutti gli utenti', () => {
    const f = filtroRicercaProfili('sconto%') ?? '';
    expect(f, '«%» vuol dire «qualunque cosa»: da solo tirerebbe fuori tutti').not.toContain('%sconto%%');
    expect(f).toContain('full_name.ilike.%sconto_%');
  });

  it('ma un «_» dentro un indirizzo non fa sparire nessuno', () => {
    const f = filtroRicercaProfili('mario_rossi@piacenza.it') ?? '';
    expect(f, 'toglierlo avrebbe fatto sparire una riga che esiste')
      .toContain('full_name.ilike.%mario_rossi@piacenza.it%');
  });

  it('sotto le due lettere non si disturba il database', () => {
    expect(filtroRicercaProfili('a')).toBeNull();
    expect(filtroRicercaProfili('   ')).toBeNull();
    expect(filtroRicercaProfili(' ,, ')).toBeNull();
  });
});

describe('l’email, che in profiles non c’è', () => {
  const contatti = [
    { id: 'a', email: 'Vecchia@Cliente.it', phone: null },
    { id: 'b', email: 'altro@cliente.it', phone: '0523111222' },
    { id: 'c', email: null, phone: null },
  ];

  it('si cerca fra le righe di auth, senza distinzione fra maiuscole e minuscole', () => {
    expect(idsDaContattiAuth(contatti, 'vecchia@')).toEqual(['a']);
    expect(idsDaContattiAuth(contatti, 'CLIENTE.IT')).toEqual(['a', 'b']);
    expect(idsDaContattiAuth(contatti, '0523')).toEqual(['b']);
    expect(idsDaContattiAuth(contatti, 'nessuno')).toEqual([]);
  });

  it('chi arriva da due strade compare una volta sola', () => {
    const perTesto = [{ id: 'a', full_name: 'Vecchia' }];
    const perEmail = [{ id: 'a', full_name: 'Vecchia' }, { id: 'b', full_name: 'Altro' }];
    expect(unisciPerId(perTesto, perEmail).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('una risposta senza la forma attesa non vale come «cercato su tutti»', () => {
    expect(risultatiRicerca(undefined)).toBeNull();
    expect(risultatiRicerca([{ id: 'a' }]), 'un elenco nudo non dice dove è stato cercato').toBeNull();
    expect(risultatiRicerca({ righe: [{ id: 'a' }], troncato: false })).toEqual({
      righe: [{ id: 'a' }], troncato: false,
    });
  });
});

describe('il file CSV degli utenti', () => {
  const utente = (n: number): UtenteDaEsportare => ({
    id: `u${n}`, email: `c${n}@x.it`, full_name: `Cliente ${n}`, store_name: null,
    role: 'buyer', is_approved: true, created_at: '2026-09-01',
  });

  it('non è più «quello che sta a schermo»: legge finché il database dice basta', async () => {
    const tutti = Array.from({ length: 7 }, (_, i) => utente(i + 1));
    const raccolta = await raccogliUtentiDaEsportare(
      async (da, a) => tutti.slice(da, a + 1),
      { perLettura: 3 },
    );
    expect(raccolta.righe).toHaveLength(7);
    expect(raccolta.completo, 'la fine la dichiara il database con una lettura vuota').toBe(true);
    expect(contenutoCsvUtenti(raccolta)).not.toContain('INCOMPLETO');
  });

  it('se non arriva in fondo, lo scrive in prima riga e nel nome del file', async () => {
    const raccolta = await raccogliUtentiDaEsportare(
      async (da, a) => Array.from({ length: a - da + 1 }, (_, i) => utente(da + i + 1)),
      { perLettura: 2, tettoLetture: 2 },
    );
    expect(raccolta.completo).toBe(false);
    const testo = contenutoCsvUtenti(raccolta);
    expect(testo.split('\n')[0]).toContain('ATTENZIONE: elenco INCOMPLETO');
    expect(nomeFileUtenti({ oggi: '2026-09-08', completo: raccolta.completo })).toContain('-PARZIALE');
  });

  it('il file di una ricerca troncata è dichiarato parziale', () => {
    const raccolta = raccoltaDallaRicerca([utente(1)], true);
    expect(raccolta.completo).toBe(false);
    expect(contenutoCsvUtenti(raccolta)).toContain('risultati della ricerca');
    expect(nomeFileUtenti({ oggi: '2026-09-08', completo: false, ricerca: 'rossi' }))
      .toBe('mycity-utenti-2026-09-08-cerca-rossi-PARZIALE.csv');
  });

  it('un nome che sembra una formula non viene eseguito da Excel', () => {
    const raccolta = raccoltaDallaRicerca(
      [{ ...utente(1), full_name: '=HYPERLINK("http://sito-finto";"Fattura")' }],
      false,
    );
    expect(contenutoCsvUtenti(raccolta)).toContain('"\'=HYPERLINK');
  });
});

describe('i numeri si leggono', () => {
  it('mille e duecentoquaranta si scrive 1.240, non 1240', () => {
    expect(numeroItaliano(1240)).toBe('1.240');
    expect(numeroItaliano(500)).toBe('500');
    expect(numeroItaliano(1000000)).toBe('1.000.000');
  });
});
