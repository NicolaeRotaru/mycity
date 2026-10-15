/**
 * 15/10/2026 (R53) — IL CONTROLLO DELLA DERIVA ERA ROSSO OGNI MATTINA, E NON
 * DICEVA PERCHE'.
 *
 * Il lavoro «Deriva migrazioni (produzione)» deve accorgersi da solo quando il
 * database vero resta indietro rispetto al codice. Dal 21/8 all'11/10 e' finito
 * rosso 52 volte su 52 senza confrontare niente, sempre con questa riga:
 *
 *   check-migration-drift: errore Error: connect ENETUNREACH 2a05:d012:…:5432
 *
 * Il segreto conteneva la connessione diretta di Supabase, che risponde solo in
 * IPv6; i computer di GitHub Actions hanno solo IPv4. Il messaggio non lo
 * diceva, e un rosso che non spiega niente smette presto di essere aperto.
 *
 * Queste prove pretendono che il controllo, quando non si collega, dica il
 * motivo e la riga giusta da mettere — il «Session pooler» — e che non stampi
 * MAI la password. La seconda meta' lancia lo script vero da riga di comando,
 * come lo lancia la CI: cosi' si prova anche che il messaggio arriva davvero a
 * chi legge il log, e non resta in una funzione che nessuno chiama.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spiegaIlCollegamentoFallito } from '@/scripts/check-migration-drift.mjs';

const PASSWORD = 'Segretissima-123';
const DIRETTA = `postgresql://postgres:${PASSWORD}@db.clmpyfvpvfjgeviworth.supabase.co:5432/postgres`;
const POOLER = `postgresql://postgres.clmpyfvpvfjgeviworth:${PASSWORD}@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;

/** L'errore esatto del log dell'11/10 (esecuzione 38143396478), con la sua forma vera. */
function erroreDelLogVero() {
  return Object.assign(new Error('connect ENETUNREACH 2a05:d012:5aa:c900:91f4:3d05:b0f7:9572:5432'), {
    code: 'ENETUNREACH',
    errno: -101,
    syscall: 'connect',
    address: '2a05:d012:5aa:c900:91f4:3d05:b0f7:9572',
    port: 5432,
  });
}

function testo(righe: string[]) {
  return righe.join('\n');
}

describe('quando il controllo della deriva non riesce a collegarsi', () => {
  it('sull\'errore del log vero dice di usare il Session pooler, e perche\'', () => {
    const t = testo(spiegaIlCollegamentoFallito(erroreDelLogVero(), DIRETTA));
    expect(t).toContain('«Session pooler»');
    expect(t).toContain('IPv6');
    expect(t).toContain('IPv4');
    expect(t).toContain('porta 5432');
    expect(t).toContain('db.clmpyfvpvfjgeviworth.supabase.co:5432');
  });

  it('riconosce la rete irraggiungibile anche quando Node ha provato piu\' indirizzi insieme', () => {
    const gruppo = Object.assign(new AggregateError([erroreDelLogVero()], 'connect failed'), { code: undefined });
    const t = testo(spiegaIlCollegamentoFallito(gruppo, 'postgresql://postgres:x@esempio.supabase.co:5432/postgres'));
    expect(t).toContain('«Session pooler»');
    expect(t).toContain('IPv6');
  });

  it('riconosce la macchina senza IPv6 del tutto (EAFNOSUPPORT)', () => {
    const e = Object.assign(new Error('connect EAFNOSUPPORT 2a05:d012::1:5432'), {
      code: 'EAFNOSUPPORT',
      address: '2a05:d012::1',
    });
    expect(testo(spiegaIlCollegamentoFallito(e, 'postgresql://u:p@[2a05:d012::1]:5432/postgres'))).toContain('«Session pooler»');
  });

  it('con la connessione diretta spiega l\'IPv6 e indica il Session pooler qualunque sia l\'errore di rete', () => {
    // 15/10/2026 (secondo collaudo) — Qui si guardava solo «Session pooler»,
    // che stampa anche il ramo generico per ogni indirizzo Supabase: col
    // riconoscimento della connessione diretta rotto la prova restava verde.
    // Adesso pretende la spiegazione vera, quella sull'IPv6.
    const scaduto = Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' });
    const senzaCodice = new Error('Connection terminated due to connection timeout');
    for (const errore of [scaduto, senzaCodice]) {
      const t = testo(spiegaIlCollegamentoFallito(errore, DIRETTA));
      expect(t).toContain('«Session pooler»');
      expect(t).toContain('risponde solo in IPv6');
    }
  });

  it('con la connessione diretta e la password rifiutata dice «password», non «IPv6»', () => {
    // 15/10/2026 (secondo collaudo) — Il ramo della connessione diretta veniva
    // prima di quello della password: dal computer di Nicola, che l'IPv6 ce
    // l'ha, una password sbagliata riceveva il consiglio di cambiare rete.
    const accesso = Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    const t = testo(spiegaIlCollegamentoFallito(accesso, DIRETTA));
    expect(t).toContain('rifiuta utente o password');
    expect(t).not.toContain('IPv6');
    expect(t).not.toContain('la rete non arriva');
  });

  it('un nome del pooler che non si trova dice «controlla l\'indirizzo», non «controlla la password»', () => {
    // 15/10/2026 (secondo collaudo) — Regione scritta male, o aws-0 al posto di
    // aws-1: il controllo mandava a controllare la password, lo script delle
    // migrazioni (giustamente) l'indirizzo.
    const nome = Object.assign(new Error('getaddrinfo ENOTFOUND aws-0-eu-wst-3.pooler.supabase.com'), {
      code: 'ENOTFOUND',
      hostname: 'aws-0-eu-wst-3.pooler.supabase.com',
    });
    const url = `postgresql://postgres.abc:${PASSWORD}@aws-0-eu-wst-3.pooler.supabase.com:5432/postgres`;
    const t = testo(spiegaIlCollegamentoFallito(nome, url));
    expect(t).toContain('non si trova');
    expect(t).toContain('aws-0 o aws-1');
    expect(t).not.toContain('gia\' quello del pooler');
    expect(t).not.toContain('rifiuta');
    expect(t).not.toContain(PASSWORD);
  });

  it('il database locale che rifiuta la password non viene detto «spento»', () => {
    const accesso = Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    const t = testo(spiegaIlCollegamentoFallito(accesso, 'postgresql://postgres:sbagliata@127.0.0.1:5432/mycity_ci'));
    expect(t).toContain('rifiuta utente o password');
    expect(t).not.toContain('non risponde');
  });

  it('una password di poche lettere non storpia il messaggio d\'errore', () => {
    // 15/10/2026 (secondo collaudo) — Con la password «x» l'errore «timeout
    // expired» diventava «timeout e***pired».
    const scaduto = new Error('timeout expired');
    const t = testo(spiegaIlCollegamentoFallito(scaduto, 'postgresql://postgres.abc:x@aws-0-eu-west-3.pooler.supabase.com:6543/postgres'));
    expect(t).toContain('Errore: timeout expired');
    // Da quattro lettere in su si oscura come prima.
    const lunga = new Error('autenticazione fallita per Pa55');
    expect(testo(spiegaIlCollegamentoFallito(lunga, 'postgresql://u:Pa55@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'))).not.toContain(
      'Pa55',
    );
  });

  it('se la riga e\' gia\' quella del pooler non manda a rimetterla: indica password e utente', () => {
    const accesso = Object.assign(new Error('password authentication failed for user "postgres"'), { code: '28P01' });
    const t = testo(spiegaIlCollegamentoFallito(accesso, POOLER));
    expect(t).not.toContain('IPv6');
    expect(t).toContain('postgres.<progetto>');
  });

  it('non stampa MAI la password, nemmeno se l\'errore ripete la stringa intera', () => {
    const conCaratteriStrani = `postgresql://postgres:${encodeURIComponent('p@ss/word')}@db.x.supabase.co:5432/postgres`;
    for (const url of [DIRETTA, POOLER, conCaratteriStrani]) {
      const chiacchierone = Object.assign(new Error(`could not connect to ${decodeURIComponent(url)}`), { code: 'ECONNREFUSED' });
      for (const errore of [erroreDelLogVero(), chiacchierone]) {
        const t = testo(spiegaIlCollegamentoFallito(errore, url));
        expect(t).not.toContain(PASSWORD);
        expect(t).not.toContain('p@ss/word');
      }
    }
  });

  it('non stampa la password nemmeno nella forma codificata, e nemmeno da sola fuori dalla riga', () => {
    // 15/10/2026 (collaudo) — La prova di sopra mette nell'errore solo la forma
    // decodificata: togliendo l'oscuramento di quella codificata restava verde.
    // Qui l'errore ripete la password com'e' scritta nella riga (p%40ss%2Fword)
    // e, a parte, da sola: tutte e due le forme devono sparire.
    const scritta = encodeURIComponent('p@ss/word');
    const url = `postgresql://postgres:${scritta}@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;
    const errore = Object.assign(new Error(`autenticazione fallita con «${scritta}» (decodificata: «p@ss/word»)`), { code: '28P01' });
    const t = testo(spiegaIlCollegamentoFallito(errore, url));
    expect(t).not.toContain(scritta);
    expect(t).not.toContain('p@ss/word');
    expect(t).toContain('***');
  });

  it('una riga illeggibile non porta la password nel testo, e spiega come si scrive', () => {
    const illeggibile = 'postgresql://postgres.ref:Pa#Segreto9@aws-0-eu-west-3.pooler.supabase.com:5432/postgres';
    const chiacchierone = new Error(`Invalid URL: ${illeggibile}`);
    const t = testo(spiegaIlCollegamentoFallito(chiacchierone, illeggibile));
    expect(t).not.toContain('Segreto9');
    expect(t).toContain('%23');
    expect(t).toContain('«Session pooler»');
  });

  it('il database di questa stessa macchina che non risponde non manda al Session pooler', () => {
    const rifiuto = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED', address: '127.0.0.1' });
    for (const url of [
      'postgresql://postgres:postgres@localhost:5432/mycity_ci',
      'postgresql://postgres:postgres@127.0.0.1:5432/mycity_ci',
      'postgresql://postgres:postgres@[::1]:5432/mycity_ci',
    ]) {
      const t = testo(spiegaIlCollegamentoFallito(rifiuto, url));
      expect(t, url).not.toContain('Session pooler');
      expect(t, url).toContain('questa stessa macchina');
    }
  });

  it('una password sbagliata su un database qualsiasi dice «password», non «Session pooler»', () => {
    const accesso = Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' });
    const t = testo(spiegaIlCollegamentoFallito(accesso, 'postgresql://app:x@db.esempio.it:5432/app'));
    expect(t).toContain('password');
    expect(t).not.toContain('Session pooler');
  });

  it('una stringa che non si legge non fa esplodere la spiegazione', () => {
    const t = testo(spiegaIlCollegamentoFallito(new Error('boh'), 'non e un indirizzo'));
    expect(t).toContain('non riesco a collegarmi');
    expect(t).toContain('«Session pooler»');
  });
});

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Lo script vero, avviato come lo avvia la CI (`npm run db:check-drift`). */
function lancia(env: Record<string, string>, script = 'scripts/check-migration-drift.mjs') {
  const esito = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 20_000,
    // Un ambiente pulito, non quello di chi lancia le prove: un SUPABASE_DB_URL
    // vero rimasto nella shell farebbe collegare la prova a un database vero.
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
  });
  return { uscita: esito.status ?? -1, uscitaTesto: `${esito.stdout}\n${esito.stderr}` };
}

describe('lo script vero, lanciato come nella CI', () => {
  it('senza la stringa e con SALTO_E_ERRORE=1 esce rosso e mostra la riga del Session pooler, non quella diretta', () => {
    const { uscita, uscitaTesto } = lancia({ SALTO_E_ERRORE: '1' });
    expect(uscita).toBe(1);
    expect(uscitaTesto).toContain('«Session pooler»');
    expect(uscitaTesto).toContain('pooler.supabase.com:5432');
    expect(uscitaTesto).not.toContain('@db.<ref>.supabase.co');
  });

  it('quando il database non risponde esce rosso con la spiegazione, senza password e senza traccia nuda', () => {
    // 127.0.0.1 porta 1: nessuno ascolta, il rifiuto e' immediato e non esce
    // dalla macchina — niente rete vera. E' il caso del passo «Coerenza
    // interna» della CI col Postgres locale non ancora pronto: li' il Session
    // pooler non c'entra, e il messaggio non deve mandarci (collaudo del 15/10).
    const { uscita, uscitaTesto } = lancia({ SUPABASE_DB_URL: `postgresql://postgres:${PASSWORD}@127.0.0.1:1/postgres` });
    expect(uscita).toBe(1);
    expect(uscitaTesto).toContain('non riesco a collegarmi al database (127.0.0.1:1)');
    expect(uscitaTesto).toContain('questa stessa macchina');
    expect(uscitaTesto).not.toContain('Session pooler');
    expect(uscitaTesto).not.toContain(PASSWORD);
    expect(uscitaTesto).not.toContain('check-migration-drift: errore');
  });

  it('con una password incollata a mano con # o / esce rosso spiegando come scriverla, senza traccia nuda', () => {
    // 15/10/2026 (collaudo) — Prima `new pg.Client(...)` stava fuori dal try:
    // usciva «check-migration-drift: errore TypeError: Invalid URL» e basta.
    // Il nome della macchina finisce in .invalid: anche se la riga si leggesse,
    // nessuna rete vera verrebbe toccata.
    for (const segreto of ['Pa#Segreto9', 'Pa/Segreto9']) {
      const { uscita, uscitaTesto } = lancia({
        SUPABASE_DB_URL: `postgresql://postgres.ref:${segreto}@aws-0-eu-west-3.pooler.invalid:5432/postgres`,
      });
      expect(uscita, uscitaTesto).toBe(1);
      expect(uscitaTesto).toContain('non si legge');
      expect(uscitaTesto).toContain('%23');
      expect(uscitaTesto).not.toContain('Segreto9');
      expect(uscitaTesto).not.toContain('check-migration-drift: errore');
    }
  });

  it('lanciato da un percorso che passa per un collegamento simbolico controlla lo stesso, e non esce verde muto', () => {
    // 15/10/2026 (collaudo) — La guardia d'avvio confrontava il percorso
    // scritto con quello vero: da un collegamento usciva 0 senza dire niente.
    const cartella = mkdtempSync(join(tmpdir(), 'deriva-collegamento-'));
    cartelle.push(cartella);
    const collegamento = join(cartella, 'deposito');
    symlinkSync(process.cwd(), collegamento);
    const { uscita, uscitaTesto } = lancia({ SALTO_E_ERRORE: '1' }, join(collegamento, 'scripts/check-migration-drift.mjs'));
    expect(uscita, uscitaTesto).toBe(1);
    expect(uscitaTesto).toContain('manca SUPABASE_DB_URL');
  });
});
