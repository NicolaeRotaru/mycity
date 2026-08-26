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

describe('la verifica vera è montata nella pagina, e sta PRIMA del cambio', () => {
  it('la pagina verifica la password attuale con signInWithPassword', () => {
    expect(sorgente).toContain('signInWithPassword({');
    expect(sorgente).toContain('password: currentPassword');
  });

  it('la verifica viene PRIMA di updateUser: se fallisce non si arriva a cambiare niente', () => {
    const verifica = sorgente.indexOf('signInWithPassword({');
    const cambio = sorgente.indexOf('updateUser({ password: newPassword })');
    expect(verifica).toBeGreaterThan(-1);
    expect(cambio).toBeGreaterThan(-1);
    expect(verifica).toBeLessThan(cambio);
  });

  it('se la verifica fallisce, il motivo lo dice — e non prosegue', () => {
    const dopoVerifica = sorgente.slice(sorgente.indexOf('signInWithPassword({'));
    const blocco = dopoVerifica.slice(0, dopoVerifica.indexOf('updateUser('));
    expect(blocco).toContain('Password attuale non corretta');
    expect(blocco).toContain('return;');
  });

  it('il pulsante non si accende senza la password attuale', () => {
    expect(sorgente).toContain('puoiProvareACambiare({ currentPassword, newPassword, confirmPassword })');
    expect(sorgente).not.toContain('disabled={!newPassword || !confirmPassword}');
  });

  it('`currentPassword` non è più una decorazione: la pagina la USA', () => {
    // Prima compariva due volte: la useState e il value del campo. Nient'altro.
    const usi = sorgente.split('currentPassword').length - 1;
    expect(usi).toBeGreaterThan(3);
  });
});
