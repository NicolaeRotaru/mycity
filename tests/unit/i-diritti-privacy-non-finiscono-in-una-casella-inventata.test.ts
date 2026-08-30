import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { recapitoPrivacy, titolare } from '@/lib/legal/titolare';

/**
 * 27/8/2026 (R053) — I DIRITTI GDPR FINIVANO IN UNA CASELLA SCRITTA NEL CODICE.
 *
 * In `lib/legal/titolare.ts` ogni dato del titolare passa da un filtro: se la
 * variabile non c'è, la riga non si stampa — meglio una riga in meno che un
 * dato inventato. L'indirizzo per la privacy era l'eccezione: mancando la
 * variabile ripiegava su `privacy@mycity.it`, scritto dentro il codice.
 *
 * Quell'indirizzo è la porta dell'articolo 15 e dell'articolo 17: è dove una
 * persona scrive per chiedere una copia dei suoi dati o per farseli cancellare,
 * e da dove parte il termine di un mese per rispondere. Un dominio che non è
 * quello di produzione vuol dire che quella richiesta non arriva a nessuno, e
 * il silenzio vale come rifiuto.
 *
 * Adesso, se la casella vera non è configurata, l'informativa manda al modulo
 * dei contatti — che scrive nel database e qualcuno lo legge — invece di
 * mandare a un indirizzo che non esiste.
 */

const VARIABILE = 'NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY';

describe('dove finisce chi vuole esercitare i suoi diritti', () => {
  const salvata = process.env[VARIABILE];
  afterEach(() => {
    if (salvata === undefined) delete process.env[VARIABILE];
    else process.env[VARIABILE] = salvata;
  });

  it('senza una casella vera si finisce al modulo dei contatti, non in un buco', () => {
    delete process.env[VARIABILE];
    const dove = recapitoPrivacy();
    expect(
      dove.href,
      'una richiesta di cancellazione mandata a una casella che nessuno legge è una mancata risposta entro il mese',
    ).toBe('/contact');
    expect(dove.href.startsWith('mailto:')).toBe(false);
    expect(dove.eUnaCasella).toBe(false);
    expect(dove.testo).not.toContain('@');
  });

  it('un indirizzo segnaposto non conta come casella vera', () => {
    process.env[VARIABILE] = 'da definire';
    expect(recapitoPrivacy().href).toBe('/contact');
  });

  it('con la casella vera configurata si scrive lì', () => {
    process.env[VARIABILE] = 'privacy@mycity-vero.it';
    const dove = recapitoPrivacy();
    expect(dove.href).toBe('mailto:privacy@mycity-vero.it');
    expect(dove.testo).toBe('privacy@mycity-vero.it');
    expect(dove.eUnaCasella).toBe(true);
  });

  it('la macchina sa se la casella è vera o è il ripiego', () => {
    delete process.env[VARIABILE];
    expect(
      titolare().emailPrivacyConfigurata,
      'senza questo il ripiego scritto nel codice è indistinguibile da un dato vero',
    ).toBe(false);
    process.env[VARIABILE] = 'privacy@mycity-vero.it';
    expect(titolare().emailPrivacyConfigurata).toBe(true);
  });
});

/**
 * Le variabili che il codice legge e nessuno ha mai dichiarato.
 *
 * Sono `NEXT_PUBLIC_`: finiscono dentro il pacchetto quando il sito viene
 * COMPILATO. Se al momento della compilazione non ci sono, restano vuote per
 * sempre nel sito pubblicato — metterle dopo non basta. Una variabile che il
 * codice legge e che il file di esempio non nomina è una variabile che nessuno
 * mettera' mai, perché nessuno sa che esista.
 */
describe('le variabili del titolare sono tutte dichiarate', () => {
  it('ogni variabile letta da titolare.ts compare in .env.example', () => {
    const sorgente = readFileSync(path.join(process.cwd(), 'lib/legal/titolare.ts'), 'utf8');
    const esempio = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
    const lette = [...sorgente.matchAll(/process\.env\.(NEXT_PUBLIC_TITOLARE_[A-Z_]+)/g)].map((m) => m[1]);
    expect(lette.length).toBeGreaterThan(5);
    const nonDichiarate = [...new Set(lette)].filter(
      (v) => !new RegExp(`^${v}=`, 'm').test(esempio),
    );
    expect(
      nonDichiarate,
      `queste variabili le legge il codice e non le dichiara nessuno:\n  ${nonDichiarate.join('\n  ')}`,
    ).toEqual([]);
  });
});
