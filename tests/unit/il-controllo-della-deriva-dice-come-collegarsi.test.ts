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
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
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

  it('con la connessione diretta indica il Session pooler qualunque sia l\'errore', () => {
    const scaduto = Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' });
    expect(testo(spiegaIlCollegamentoFallito(scaduto, DIRETTA))).toContain('«Session pooler»');
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

  it('una stringa che non si legge non fa esplodere la spiegazione', () => {
    const t = testo(spiegaIlCollegamentoFallito(new Error('boh'), 'non e un indirizzo'));
    expect(t).toContain('non riesco a collegarmi');
    expect(t).toContain('«Session pooler»');
  });
});

/** Lo script vero, avviato come lo avvia la CI (`npm run db:check-drift`). */
function lancia(env: Record<string, string>) {
  const esito = spawnSync(process.execPath, ['scripts/check-migration-drift.mjs'], {
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
    // dalla macchina — niente rete vera.
    const { uscita, uscitaTesto } = lancia({ SUPABASE_DB_URL: `postgresql://postgres:${PASSWORD}@127.0.0.1:1/postgres` });
    expect(uscita).toBe(1);
    expect(uscitaTesto).toContain('non riesco a collegarmi al database (127.0.0.1:1)');
    expect(uscitaTesto).toContain('«Session pooler»');
    expect(uscitaTesto).not.toContain(PASSWORD);
    expect(uscitaTesto).not.toContain('check-migration-drift: errore');
  });
});
