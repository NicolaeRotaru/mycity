import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  perchePasswordNonCambiabile,
  puoiProvareACambiare,
  LUNGHEZZA_MINIMA,
} from '@/lib/account/cambio-password';

/**
 * LA PASSWORD ATTUALE SI CONTROLLA DAVVERO (radiografia del design, 22/8/2026).
 *
 * La schermata «Cambia password» chiedeva la password attuale e non la leggeva
 * mai: `currentPassword` compariva due volte in tutto il file — la dichiarazione
 * dello stato e il binding del campo. Il pulsante era
 * `disabled={!newPassword || !confirmPassword}`, quindi il campo si poteva
 * lasciare VUOTO e la password cambiava lo stesso.
 *
 * La radiografia l'aveva classificato «Microcopy», come un'etichetta che promette
 * un controllo inesistente. È di più: è il controllo di sicurezza di una schermata
 * di sicurezza. Chi si trovasse fra le mani una sessione aperta — un telefono
 * lasciato sbloccato, un computer condiviso — poteva cambiare la password senza
 * conoscere quella vecchia, cioè prendersi l'account e chiuderne fuori il
 * proprietario.
 */

const RADICE = resolve(__dirname, '..', '..');
const PAGINA = 'app/profile/settings/page.tsx';
const sorgente = readFileSync(resolve(RADICE, PAGINA), 'utf8');

const validi = { currentPassword: 'vecchia-buona', newPassword: 'nuovissima1', confirmPassword: 'nuovissima1' };

describe('le condizioni prima di toccare l’account', () => {
  it('con tutto a posto non c’è nessun motivo per fermarsi', () => {
    expect(perchePasswordNonCambiabile(validi)).toBeNull();
    expect(puoiProvareACambiare(validi)).toBe(true);
  });

  it('IL CASO CHE ROMPEVA — password attuale vuota: si deve fermare', () => {
    const campi = { ...validi, currentPassword: '' };
    expect(perchePasswordNonCambiabile(campi)).toBe('Inserisci la password attuale');
    expect(puoiProvareACambiare(campi)).toBe(false);
  });

  it('la password attuale mancante si dice PER PRIMA, non per ultima', () => {
    // È il campo in cima al modulo: scoprirlo dopo aver risistemato gli altri due
    // vuol dire ricominciare da capo.
    const tuttoSbagliato = { currentPassword: '', newPassword: 'corta', confirmPassword: 'diversa' };
    expect(perchePasswordNonCambiabile(tuttoSbagliato)).toBe('Inserisci la password attuale');
  });

  it('la nuova password sotto il minimo si ferma, e il minimo lo dice', () => {
    const corta = { ...validi, newPassword: 'abc123', confirmPassword: 'abc123' };
    expect(perchePasswordNonCambiabile(corta)).toContain(String(LUNGHEZZA_MINIMA));
  });

  it('le due nuove che non coincidono si fermano', () => {
    expect(perchePasswordNonCambiabile({ ...validi, confirmPassword: 'un-altra1' })).toBe(
      'Le password non coincidono',
    );
  });
});

/**
 * 27/8/2026 (R019) — QUESTE VERIFICHE CERTIFICAVANO IL DIFETTO, E VANNO
 * RISCRITTE.
 *
 * Pretendevano che nella PAGINA ci fosse `signInWithPassword` prima di
 * `updateUser({ password })`. Ma `app/profile/settings/page.tsx` è un
 * componente client: quelle due chiamate giravano tutte e due nel browser, e
 * sono indipendenti. Chi controlla la pagina — la console degli strumenti per
 * sviluppatori, un'estensione ostile, uno script iniettato — chiamava
 * direttamente la seconda e saltava la prima. Il controllo c'era, e non
 * difendeva da niente: una sessione rubata diventava un account perso per
 * sempre, perché con la password cambiata il proprietario vero non rientra
 * più. Su un venditore vuol dire negozio, catalogo e conto Stripe collegato al
 * payout.
 *
 * Quello che serve non è che la verifica venga PRIMA nel file: è che stia dove
 * il browser non arriva. Adesso verifica e cambio sono una cosa sola dietro
 * /api/account/cambia-password, e la prova che quella rotta rifiuta la password
 * sbagliata sta in `tests/unit/la-password-si-cambia-solo-sul-server.test.ts`.
 * Qui resta il confine: la pagina non deve più poter cambiare la password da
 * sola.
 */
describe('la pagina non cambia più la password da sola', () => {
  it('IL CASO CHE ROMPEVA — nel browser non c è nessun cambio password diretto', () => {
    expect(
      sorgente,
      'la pagina cambia la password dal browser: chi ha in mano la sessione salta la verifica',
    ).not.toContain('updateUser({ password');
  });

  it('la pagina delega alla rotta che fa verifica e cambio insieme', () => {
    expect(sorgente).toContain('/api/account/cambia-password');
    expect(sorgente).toContain('passwordAttuale');
  });

  it('il pulsante non si accende senza la password attuale', () => {
    expect(sorgente).toContain('puoiProvareACambiare({ currentPassword, newPassword, confirmPassword })');
    expect(sorgente).not.toContain('disabled={!newPassword || !confirmPassword}');
  });

  it('`currentPassword` non è una decorazione: la pagina la USA', () => {
    // Prima compariva due volte: la useState e il value del campo. Nient'altro.
    const usi = sorgente.split('currentPassword').length - 1;
    expect(usi).toBeGreaterThan(3);
  });
});
