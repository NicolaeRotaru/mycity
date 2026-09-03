import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cancellaAccount, TABELLE_CON_DATI_PERSONALI } from '@/lib/account/cancellazione';

/**
 * 3/9/2026 — CANCELLATO L'ACCOUNT, L'INDIRIZZO DI CASA RESTAVA DENTRO GLI ORDINI.
 *
 * Maria Rossi ordina il pane da Pane Quotidiano. Nella riga dell'ordine ci
 * finiscono il suo nome, il cellulare, la via col numero civico, le coordinate
 * della porta di casa e la nota per il fattorino: «citofono Rossi, secondo
 * piano». Poi chiede di cancellare l'account.
 *
 * `orders` non era nell'elenco unico delle tabelle da ripulire, e la sua
 * chiave verso la persona e' ON DELETE SET NULL: la riga resta e `user_id`
 * diventa NULL. Quei dati sopravvivevano tutti, in chiaro, senza piu' il filo
 * che li riportava a lei — irrintracciabili anche per chi li avesse voluti
 * togliere il giorno dopo. Intanto le impostazioni le promettevano «ordini
 * anonimizzati».
 *
 * Queste prove eseguono la cancellazione vera su un ordine finto e guardano la
 * riga DOPO. Diventano rosse se `orders` esce dall'elenco, se qualcuno sposta
 * la pulizia dopo la chiusura dell'account (a quel punto `user_id` e' gia'
 * NULL e la pulizia non trova piu' niente) o se sparisce la riga dei conti.
 */

const MARIA = '11111111-1111-4111-8111-111111111111';

/** I campi che dicono CHI E' la persona: dopo la cancellazione devono essere vuoti. */
const CHI_E_LA_PERSONA = [
  'delivery_full_name',
  'delivery_phone',
  'delivery_address',
  'delivery_zip',
  'delivery_notes',
  'delivery_lat',
  'delivery_lng',
] as const;

/**
 * I campi della consegna che RESTANO, e il perche' di ognuno. Insieme a quelli
 * qui sopra devono coprire ogni colonna `delivery_*` della tabella: e' il
 * cancello che obbliga a classificare anche la colonna che nascera' domani.
 */
const COSA_RESTA_E_PERCHE: Record<string, string> = {
  delivery_city: 'la citta e Piacenza per tutti: dice dove abbiamo consegnato, non chi',
  delivery_status: 'a che punto e arrivato l ordine: serve ai conti del negozio',
  delivery_slot: 'la fascia scelta (Domani 9-12): un orario, non una persona',
  delivery_fee_cents: 'quanto e costata la consegna: e una riga di soldi',
  delivery_photo_url: 'la tocca cancellaProveDiConsegna DOPO aver tolto il file dallo storage',
  delivery_signature_url: 'come sopra: prima il file, poi la colonna che lo ritrova',
};

/** Un ordine come esce dalla cassa, con tutto quello che il fattorino usa per suonare. */
function ordineDiMaria(): Record<string, unknown> {
  return {
    id: 'ordine-1',
    user_id: MARIA,
    seller_id: 'pane-quotidiano',
    created_at: '2026-09-03T18:12:00.000Z',
    total_price: 24.5,
    delivery_fee_cents: 300,
    delivery_status: 'DELIVERED',
    delivery_slot: 'Domani · 9:00-12:00',
    payment_method: 'card',
    delivery_full_name: 'Maria Rossi',
    delivery_phone: '+39 333 1234567',
    delivery_address: 'Via Roma 12',
    delivery_city: 'Piacenza',
    delivery_zip: '29121',
    delivery_notes: 'citofono Rossi, secondo piano',
    delivery_lat: 45.0526,
    delivery_lng: 9.6929,
    cash_photo_url: null,
    delivery_photo_url: 'fattorino-9/ordine-1/porta-di-casa.jpg',
    cash_signature_url: null,
  };
}

/**
 * Un finto marketplace che tiene DAVVERO la riga dell'ordine e le applica gli
 * aggiornamenti. Non guarda cosa la pipeline ha chiesto di scrivere: guarda
 * com'e' rimasta la riga alla fine — che e' la sola cosa che una persona
 * cancellata si porta a casa.
 *
 * `deleteUser` fa quello che fa il database vero: stacca il legame
 * (`user_id` = NULL, ON DELETE SET NULL). Cosi' una pulizia spostata dopo la
 * chiusura dell'account non trova piu' nessuna riga, e questa prova lo vede.
 */
function fintoMarketplace(
  ordini: Array<Record<string, unknown>>,
  /** Il database rifiuta la pulizia degli ordini con questo messaggio. */
  ordiniRifiutano?: string,
) {
  const tolteDalloStorage: string[] = [];
  let accountChiuso = false;

  const admin = {
    from(tabella: string) {
      return {
        select: (_colonne: string) => ({
          eq: async (colonna: string, valore: unknown) => {
            if (tabella === 'orders') {
              return { data: ordini.filter((r) => r[colonna] === valore), error: null };
            }
            return { data: [], error: null };
          },
        }),
        update: (valori: Record<string, unknown>) => ({
          eq: async (colonna: string, valore: unknown) => {
            if (tabella === 'orders' && ordiniRifiutano && 'delivery_full_name' in valori) {
              return { error: { message: ordiniRifiutano } };
            }
            if (tabella === 'orders') {
              for (const riga of ordini) {
                if (riga[colonna] === valore) Object.assign(riga, valori);
              }
            }
            return { error: null };
          },
        }),
        delete: () => ({ ilike: async () => ({ error: null }) }),
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'maria.rossi@example.it' } } }),
        deleteUser: async () => {
          accountChiuso = true;
          for (const riga of ordini) if (riga.user_id === MARIA) riga.user_id = null;
          return { error: null };
        },
      },
    },
    storage: {
      from: (_secchio: string) => ({
        list: async () => ({ data: [], error: null }),
        remove: async (percorsi: string[]) => {
          tolteDalloStorage.push(...percorsi);
          return { error: null };
        },
      }),
    },
  };

  return { admin, tolteDalloStorage, chiuso: () => accountChiuso };
}

describe('l ordine di chi ha cancellato l account', () => {
  it('non dice piu chi e la persona: nome, telefono, via, note e coordinate sono vuoti', async () => {
    const ordini = [ordineDiMaria()];
    const { admin } = fintoMarketplace(ordini);

    const esito = await cancellaAccount(admin as never, MARIA);
    expect(esito.ok, esito.errore ?? '').toBe(true);

    const riga = ordini[0];
    for (const campo of CHI_E_LA_PERSONA) {
      expect(
        riga[campo] ?? null,
        `dentro l'ordine resta ${campo} = ${String(riga[campo])} — e ora nessuno sa piu di chi e, ` +
          `perche il legame con la persona e gia staccato`,
      ).toBeNull();
    }
  });

  it('la riga dei conti resta intera: e una scrittura contabile, si tiene dieci anni', async () => {
    const ordini = [ordineDiMaria()];
    const { admin } = fintoMarketplace(ordini);

    await cancellaAccount(admin as never, MARIA);

    expect(ordini.length, 'la riga dell ordine e sparita: al negozio manca il venduto e a noi la contabilita').toBe(1);
    const riga = ordini[0];
    expect(riga.id).toBe('ordine-1');
    expect(riga.total_price).toBe(24.5);
    expect(riga.delivery_fee_cents).toBe(300);
    expect(riga.created_at).toBe('2026-09-03T18:12:00.000Z');
    expect(riga.seller_id).toBe('pane-quotidiano');
    expect(riga.delivery_status).toBe('DELIVERED');
    expect(riga.payment_method).toBe('card');
    expect(riga.delivery_city, 'la citta e Piacenza per tutti: toglierla non protegge nessuno e cancella le statistiche').toBe('Piacenza');
  });

  it('il legame con la persona e staccato: la pulizia doveva avvenire prima', async () => {
    // Se qualcuno sposta la pulizia dopo la chiusura dell'account, questa riga
    // resta piena e la prova qui sopra diventa rossa: e' il motivo per cui
    // l'ordine dei passi non e' un dettaglio.
    const ordini = [ordineDiMaria()];
    const { admin } = fintoMarketplace(ordini);
    await cancellaAccount(admin as never, MARIA);
    expect(ordini[0].user_id).toBeNull();
  });

  it('la fotografia della porta di casa viene tolta dallo storage, non solo scollegata', async () => {
    // Il tranello: se qualcuno mette `delivery_photo_url` fra i campi da
    // azzerare nell'elenco, quella colonna viene svuotata PRIMA — e il file
    // resta nello storage per sempre, perche' era l'unico filo per trovarlo.
    const ordini = [ordineDiMaria()];
    const { admin, tolteDalloStorage } = fintoMarketplace(ordini);

    await cancellaAccount(admin as never, MARIA);

    expect(
      tolteDalloStorage,
      'la foto dell ingresso di casa e rimasta nello storage: la colonna che la ritrovava e stata svuotata troppo presto',
    ).toContain('fattorino-9/ordine-1/porta-di-casa.jpg');
    expect(ordini[0].delivery_photo_url).toBeNull();
  });
});

describe('quando il database rifiuta la pulizia degli ordini', () => {
  // Sugli ordini c'e' un guardiano che blocca la modifica dei campi protetti
  // (migrations/061): la nostra pulizia passa perche' gira con la chiave di
  // servizio. Se un giorno quel permesso cambia, il rifiuto arriva qui — e
  // prima nessuno guardava la risposta: si tirava dritto fino a chiudere
  // l'account, e da quel momento l'indirizzo di casa non era piu' ritrovabile.
  const IL_GUARDIANO = 'orders: modifica di un campo protetto non consentita';

  it('l account NON viene cancellato: quei dati dopo non si ritroverebbero piu', async () => {
    const ordini = [ordineDiMaria()];
    const { admin, chiuso } = fintoMarketplace(ordini, IL_GUARDIANO);

    const esito = await cancellaAccount(admin as never, MARIA);

    expect(esito.ok).toBe(false);
    expect(
      chiuso(),
      'l account e stato chiuso lo stesso: nome, telefono e indirizzo restano scritti nell ordine ' +
        'e il legame con la persona non c e piu — non si riparano nemmeno a mano',
    ).toBe(false);
    expect(ordini[0].delivery_full_name).toBe('Maria Rossi');
  });

  it('lo dice, e dice quale tabella: senza un motivo il giro notturno non sveglia nessuno', async () => {
    const { admin } = fintoMarketplace([ordineDiMaria()], IL_GUARDIANO);
    const esito = await cancellaAccount(admin as never, MARIA);

    expect(esito.errore).toContain('orders');
    expect(esito.errore).toContain(IL_GUARDIANO);
    // Nessun `motivo`: per lib/cron-cancellazioni.ts questo e' un GUASTO, non un
    // rinvio deciso da noi. La notte diventa rossa e qualcuno se ne accorge.
    expect(esito.motivo).toBeUndefined();
  });

  it('una tabella che sparisce con l utente non ferma niente', async () => {
    // Se a rifiutare fosse una riga che se ne va comunque insieme all'account
    // (CASCADE), fermarsi non proteggerebbe nessuno: la riga sparisce lo stesso.
    const ordini = [ordineDiMaria()];
    const { admin, chiuso } = fintoMarketplace(ordini);
    const esito = await cancellaAccount(admin as never, MARIA);
    expect(esito.ok).toBe(true);
    expect(chiuso()).toBe(true);
  });
});

describe('l elenco unico delle tabelle da ripulire', () => {
  const voceOrdini = TABELLE_CON_DATI_PERSONALI.find((t) => t.tabella === 'orders');

  it('contiene gli ordini, con la colonna che li lega alla persona', () => {
    expect(
      voceOrdini,
      'orders non e nell elenco: nome, cellulare, indirizzo e coordinate della porta restano scritti dentro',
    ).toBeTruthy();
    expect(voceOrdini?.colonna).toBe('user_id');
  });

  it('dice che la riga sopravvive: e per questo che va ripulita prima', () => {
    expect(
      voceOrdini?.sopravvive,
      'segnata come se sparisse con l utente: l ordine invece resta, e resta pieno',
    ).toBe(true);
  });

  it('non chiede di azzerare le colonne delle prove di consegna', () => {
    for (const colonna of ['cash_photo_url', 'delivery_photo_url', 'cash_signature_url']) {
      expect(
        Object.keys(voceOrdini?.azzera ?? {}),
        `${colonna} e l unico filo che porta al file nello storage: svuotarla qui lascia la fotografia online per sempre`,
      ).not.toContain(colonna);
    }
  });

  it('ogni colonna che chiede di azzerare esiste davvero', () => {
    // Il tranello gia' visto con le recensioni al fattorino: una colonna che
    // non esiste fa respingere TUTTO l'aggiornamento, e allora non si pulisce
    // piu' niente di quella tabella. I tipi sono generati dallo schema vero.
    const tipi = readFileSync('lib/database.types.ts', 'utf8');
    for (const voce of TABELLE_CON_DATI_PERSONALI) {
      for (const colonna of Object.keys(voce.azzera)) {
        expect(
          colonneDi(tipi, voce.tabella),
          `${voce.tabella}.${colonna} non esiste nello schema: il database rifiuta l intero aggiornamento ` +
            `e di quella tabella non si ripulisce piu niente`,
        ).toContain(colonna);
      }
    }
  });

  it('ogni campo della consegna e classificato: o si azzera, o e dichiarato qui', () => {
    // Il cancello che chiude la malattia: una colonna nuova sugli ordini —
    // `delivery_email`, `delivery_intercom`, quello che sara' — nasce fuori da
    // ogni elenco e nessuno se ne accorge. Da qui in poi se ne accorge questa
    // prova, il giorno stesso in cui la colonna compare.
    const tipi = readFileSync('lib/database.types.ts', 'utf8');
    const classificate = new Set([...Object.keys(voceOrdini?.azzera ?? {}), ...Object.keys(COSA_RESTA_E_PERCHE)]);

    for (const colonna of colonneDi(tipi, 'orders')) {
      if (!colonna.startsWith('delivery_')) continue;
      expect(
        classificate,
        `${colonna} e una colonna della consegna che nessuno ha classificato: dire se si azzera alla ` +
          `cancellazione o se resta (e perche) e il passo che, saltato, ha lasciato l indirizzo di casa dentro gli ordini`,
      ).toContain(colonna);
    }
  });
});

/**
 * LA PAGINA DEVE DIRE QUELLO CHE SUCCEDE DAVVERO.
 *
 * Nelle impostazioni c'era scritto «Gli ordini gia' evasi resteranno
 * anonimizzati per obblighi fiscali», e non era vero: dentro l'ordine
 * restavano nome, cellulare, via e coordinate della porta di casa. Il difetto
 * non era solo il dato che sopravviveva — era la distanza fra la frase e il
 * fatto. Davanti al Garante quella distanza e' l'unica cosa che conta.
 *
 * Adesso la frase elenca le cose come stanno: cosa togliamo e cosa resta. Se
 * un domani l'elenco cambia, questa prova costringe a cambiare anche la frase.
 */
describe('quello che le impostazioni promettono a chi cancella', () => {
  const pagina = readFileSync('app/profile/settings/page.tsx', 'utf8');
  // Via i commenti: qui conta il testo che la persona legge sullo schermo, non
  // le note lasciate a chi legge il codice (che la parola vecchia la citano).
  const zonaPericolosa = pagina
    .slice(pagina.indexOf('Elimina il tuo account'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('non usa la parola «anonimizzati» per una cosa che anonimizzata non e', () => {
    expect(
      zonaPericolosa,
      'la pagina promette ordini «anonimizzati»: e la promessa che il difetto aveva tradito',
    ).not.toMatch(/anonimizzat/i);
  });

  it('dice cosa togliamo, con le parole di tutti i giorni', () => {
    for (const cosa of ['nome', 'telefono', 'indirizzo di casa', 'note per il fattorino']) {
      expect(zonaPericolosa, `la pagina non dice che togliamo «${cosa}»`).toContain(cosa);
    }
  });

  it('dice cosa resta, e per quanto', () => {
    for (const cosa of ['data', 'importo', 'negozio', 'città', '10 anni']) {
      expect(
        zonaPericolosa,
        `la pagina non dice che dell ordine resta «${cosa}»: chi cancella ha il diritto di sapere cosa teniamo`,
      ).toContain(cosa);
    }
  });
});

/** Le colonne di una tabella, lette dai tipi generati dallo schema vero. */
function colonneDi(tipi: string, tabella: string): string[] {
  const inizio = tipi.indexOf(`      ${tabella}: {`);
  if (inizio < 0) throw new Error(`la tabella ${tabella} non c'e' nei tipi generati`);
  const riga = tipi.indexOf('Row: {', inizio);
  const fine = tipi.indexOf('};', riga);
  return tipi
    .slice(riga + 'Row: {'.length, fine)
    .split('\n')
    .map((r) => r.trim().split(':')[0])
    .filter(Boolean);
}
