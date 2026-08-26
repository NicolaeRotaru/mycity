import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { traduciErroreAuth, friendlyError } from '@/lib/errors';

/**
 * GLI ERRORI DI REGISTRAZIONE E CAMBIO PASSWORD PARLANO ITALIANO
 * (radiografia del design, 22/8/2026).
 *
 * Una funzione che traduceva gli errori di Supabase Auth esisteva già, ma viveva
 * dentro `app/sign-in/page.tsx` e non era esportata: la usava solo quella pagina.
 * Registrazione, cambio password e cambio email chiamavano `friendlyError`, che ha
 * le mappe dei codici Postgres e dei guasti di rete e di errori Auth non sapeva
 * niente. Il messaggio grezzo passava i filtri finali — meno di 200 caratteri, una
 * riga sola, comincia per lettera — e usciva tale e quale.
 *
 * «User already registered», l'errore più comune della registrazione, arrivava così
 * al cliente piacentino.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');

/** I messaggi veri di Supabase Auth, come arrivano. */
const DALL_INGLESE: Array<[string, RegExp]> = [
  ['User already registered', /esiste già un account/i],
  ['Password should be at least 6 characters', /almeno 6 caratteri/i],
  ['Unable to validate email address: invalid format', /email non sembra valida/i],
  ['Email rate limit exceeded', /troppe email/i],
  ['Invalid login credentials', /email o password non corrette/i],
  ['Email not confirmed', /email non confermata/i],
  ['New password should be different from the old password', /diversa da quella attuale/i],
];

describe('quello che il cliente legge non è più inglese', () => {
  for (const [inglese, atteso] of DALL_INGLESE) {
    it(`«${inglese.slice(0, 42)}…»`, () => {
      const tradotto = traduciErroreAuth(inglese);
      expect(tradotto).not.toBeNull();
      expect(tradotto!).toMatch(atteso);

      // E ci arriva anche passando dalla porta che usano registrazione e cambio password.
      expect(friendlyError(new Error(inglese))).toMatch(atteso);
    });
  }

  it('la lunghezza minima la riporta dal messaggio, non la indovina', () => {
    expect(traduciErroreAuth('Password should be at least 12 characters')).toContain('12');
  });
});

describe('non traduce quello che non è suo', () => {
  it('su un errore che non riconosce torna null, e lascia lavorare gli altri rami', () => {
    expect(traduciErroreAuth('duplicate key value violates unique constraint')).toBeNull();
    expect(traduciErroreAuth('')).toBeNull();
    // friendlyError deve continuare a dare la SUA risposta a quell'errore.
    expect(friendlyError({ message: 'duplicate key value violates unique constraint' })).not.toMatch(
      /esiste già un account/i,
    );
  });

  it('le reti larghe di sign-in NON stanno nella funzione condivisa', () => {
    // «contiene password» e «contiene email» vanno bene su una schermata di accesso,
    // dove ogni errore parla di accesso. Dentro friendlyError, che vede ogni errore
    // dell'applicazione, tradurrebbero in «Password non valida» guasti che con
    // l'accesso non c'entrano niente.
    expect(traduciErroreAuth('column "password_hash" does not exist')).toBeNull();
    expect(traduciErroreAuth('smtp email relay unreachable')).toBeNull();
  });
});

describe('una copia sola, e il ripiego lo mette chi chiama', () => {
  it('la traduzione vive in lib/errors.ts, e sign-in ci poggia sopra', () => {
    expect(leggi('lib/errors.ts')).toContain('export function traduciErroreAuth');
    const signIn = leggi('app/sign-in/page.tsx');
    expect(signIn).toContain('traduciErroreAuth(msg)');
  });

  it('friendlyError la consulta PRIMA dei filtri generici', () => {
    const src = leggi('lib/errors.ts');
    const dentroFriendly = src.slice(src.indexOf('export function friendlyError'));
    const consulta = dentroFriendly.indexOf('traduciErroreAuth(e.message)');
    const filtroGenerico = dentroFriendly.indexOf('duplicate key value');
    expect(consulta).toBeGreaterThan(-1);
    expect(consulta).toBeLessThan(filtroGenerico);
  });

  it('sign-in tiene il suo ripiego, che è diverso da quello della registrazione', () => {
    expect(leggi('app/sign-in/page.tsx')).toContain('Accesso non riuscito. Riprova.');
  });
});

describe('non ruba i casi che avevano già una casa', () => {
  it('«too many requests» resta di friendlyError, con le sue parole', () => {
    // Questa la scoperta la suite, non io: spostando la traduzione dentro friendlyError
    // avevo portato con me una rete larga su `rate limit`, che si prendeva un caso già
    // trattato — e con parole diverse da quelle che l'applicazione usa da sempre.
    expect(traduciErroreAuth('too many requests')).toBeNull();
    expect(friendlyError({ message: 'too many requests' })).toMatch(/Troppe richieste/);
  });

  it('ma «email rate limit exceeded» sì: quello è di Auth', () => {
    expect(traduciErroreAuth('Email rate limit exceeded')).toMatch(/troppe email/i);
  });

  it('sign-in tiene la sua rete larga sui tentativi, dov’era prima', () => {
    expect(leggi('app/sign-in/page.tsx')).toContain('Troppi tentativi. Riprova fra qualche minuto.');
  });
});
