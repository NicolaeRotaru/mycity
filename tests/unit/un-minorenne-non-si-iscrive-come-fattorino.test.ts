import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anniCompiuti, controlloEta, ETA_MINIMA_RIDER } from '@/app/rider/onboarding/maggiore-eta';

/**
 * 3/9/2026 — UN QUINDICENNE POTEVA ISCRIVERSI COME FATTORINO.
 *
 * Il modulo del fattorino chiedeva la data di nascita, la scriveva nel profilo
 * e finiva lì. Nessuno la confrontava con i diciotto anni: né il modulo, né una
 * regola sul database, né la schermata con cui lo staff approva — che quella
 * data non la mostra. Sul database ricostruito dalle migrazioni il giro
 * completo passava: «fattorino di 15 anni, stato approved».
 *
 * Sotto i 16 anni è lavoro minorile, fra i 16 e i 18 ci sono vincoli, la
 * polizza RC può non coprire, e le nostre condizioni al punto 3 dicono 18.
 *
 * ⚪ QUESTA PROVA COPRE LA PORTA DEL MODULO, NON TUTTE E TRE. Il vincolo sul
 * database e la schermata di approvazione stanno fuori dal territorio di questa
 * squadra: finché non ci sono, chi sa usare gli strumenti del browser scrive la
 * data lo stesso. Il referto porta l'SQL pronto.
 */

describe('quanti anni ha compiuto, il giorno che si iscrive', () => {
  it('il giorno prima del diciottesimo compleanno ne ha diciassette', () => {
    expect(anniCompiuti('2008-06-15', '2026-06-14')).toBe(17);
  });

  it('il giorno del compleanno gli anni sono compiuti', () => {
    expect(anniCompiuti('2008-06-15', '2026-06-15')).toBe(18);
  });

  it('nato il 29 febbraio: negli anni normali il conto scatta il primo marzo', () => {
    expect(anniCompiuti('2008-02-29', '2026-02-28')).toBe(17);
    expect(anniCompiuti('2008-02-29', '2026-03-01')).toBe(18);
  });
});

describe('il cancello dei diciotto anni sul modulo del fattorino', () => {
  it('il quindicenne non passa, e legge perché', () => {
    const esito = controlloEta('2011-05-04', '2026-09-03');

    expect(esito.ok, 'un ragazzo di quindici anni arriva fino allo stato «approvato»').toBe(false);
    expect(esito.messaggio).toContain('18');
  });

  it('a un giorno dal compleanno ancora no, il giorno dopo sì', () => {
    expect(controlloEta('2008-09-04', '2026-09-03').ok).toBe(false);
    expect(controlloEta('2008-09-03', '2026-09-03').ok, 'il giorno del compleanno viene rifiutato').toBe(true);
  });

  it('chi ha l età passa senza intralci', () => {
    expect(controlloEta('1990-01-20', '2026-09-03')).toEqual({ ok: true, messaggio: null });
  });

  it('la data vuota non è un sì implicito', () => {
    const esito = controlloEta('', '2026-09-03');
    expect(esito.ok, 'senza data di nascita il modulo va avanti lo stesso').toBe(false);
    expect(esito.messaggio).toBeTruthy();
  });

  it('una data che non esiste, o scritta all italiana, non passa per buona', () => {
    expect(controlloEta('2001-02-31', '2026-09-03').ok, 'il 31 febbraio viene accettato').toBe(false);
    expect(controlloEta('27/04/2001', '2026-09-03').ok).toBe(false);
    expect(controlloEta('2028-01-01', '2026-09-03').ok, 'una data nel futuro passa').toBe(false);
  });

  it('la soglia resta quella dichiarata nelle condizioni: 18', () => {
    expect(ETA_MINIMA_RIDER).toBe(18);
  });
});

describe('il modulo controlla PRIMA di salvare', () => {
  const pagina = readFileSync(join(process.cwd(), 'app/rider/onboarding/page.tsx'), 'utf8');
  const inizio = pagina.indexOf('async function saveAndStartCheck');
  const corpo = pagina.slice(inizio, pagina.indexOf('const allRequiredUploaded'));

  it('la data di nascita si controlla prima della scrittura sul profilo', () => {
    expect(inizio, 'la funzione di salvataggio è stata rinominata: la prova va riscritta').toBeGreaterThan(-1);

    const controllo = corpo.indexOf('controlloEta(');
    const scrittura = corpo.indexOf(".from('profiles')");
    const partenzaVerifica = corpo.indexOf('/api/kyc/start-check');

    expect(controllo, 'il modulo non controlla più l età: la data torna a salvarsi e basta').toBeGreaterThan(-1);
    expect(
      controllo < scrittura,
      'l età si controlla dopo aver scritto nel profilo: la data del minorenne è già dentro',
    ).toBe(true);
    expect(
      controllo < partenzaVerifica,
      'la verifica del documento parte comunque, anche per un minorenne',
    ).toBe(true);
  });

  it('quando l età non va, la funzione si ferma davvero', () => {
    const dopoIlControllo = corpo.slice(corpo.indexOf('controlloEta('));
    const ramo = dopoIlControllo.slice(0, dopoIlControllo.indexOf(".from('profiles')"));
    expect(
      /if \(!eta\.ok\)[\s\S]*return;/.test(ramo),
      'il controllo c è ma non ferma niente: il salvataggio prosegue lo stesso',
    ).toBe(true);
  });
});
