import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  puoDireTuttoTranquillo,
  statoDellaConsolle,
  type EventoSOS,
} from '@/app/admin/sos/lettura-degli-sos';

/**
 * 3/9/2026 — LA CONSOLLE DELLE EMERGENZE DICEVA «TUTTO TRANQUILLO» ANCHE QUANDO
 * NON AVEVA LETTO NIENTE.
 *
 * Un fattorino preme il pulsante SOS di sera, in una zona isolata. L'evento
 * viene scritto nel database. In sala controllo la pagina che sorveglia gli SOS
 * leggeva così — `const { data } = await supabase…; return data ?? []` —
 * buttando via l'errore. Se la lettura non riusciva arrivava un elenco vuoto, e
 * l'elenco vuoto accendeva il riquadro VERDE col segno di spunta: «Nessun SOS
 * attivo. Tutto tranquillo.» Con l'aggiornamento automatico ogni dieci secondi
 * quella rassicurazione si ripeteva da sola all'infinito. Nessuno chiama.
 *
 * Non è il peggio di uno schermo vuoto: è una rassicurazione ATTIVA, e vale
 * sulla pagina che sorveglia la sicurezza di una persona per strada.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────
 * ① ESEGUE la regola (`statoDellaConsolle`, `puoDireTuttoTranquillo`) nei quattro
 *    casi che contano: letto e vuoto · letto con un SOS aperto · lettura fallita
 *    senza niente in mano · lettura fallita con un elenco vecchio in mano.
 * ② Legge la pagina e pretende che la frase verde stia dietro quella regola e
 *    non dietro un semplice «l'elenco è vuoto», e che la lettura sollevi
 *    l'errore invece di ingoiarlo. È lì che la malattia era nata.
 *
 * ⚪ Da qui non apro la consolle nel browser: verifico la regola e chi la
 * chiama, non i pixel del riquadro.
 */

const PAGINA = readFileSync(join(process.cwd(), 'app/admin/sos/page.tsx'), 'utf8');

function sos(id: string, risolto: boolean): EventoSOS {
  return {
    id,
    rider_id: 'rider-1',
    order_id: null,
    lat: 45.05,
    lng: 9.69,
    triggered_at: '2026-09-03T21:14:00.000Z',
    resolved_at: risolto ? '2026-09-03T21:20:00.000Z' : null,
    resolution_note: risolto ? 'chiamato, falso allarme' : null,
    rider: { full_name: 'Luca', phone: '+39 333 1234567' },
  };
}

describe('quando la consolle può dire «tutto tranquillo»', () => {
  it('letto davvero, e davvero vuoto: sì', () => {
    const stato = statoDellaConsolle({ dati: [], guasto: false, inCorso: false });
    expect(stato.letturaRiuscita).toBe(true);
    expect(puoDireTuttoTranquillo(stato)).toBe(true);
  });

  it('letto, ma c’è un SOS aperto: no, e l’SOS è in elenco', () => {
    const stato = statoDellaConsolle({ dati: [sos('a', false), sos('b', true)], guasto: false, inCorso: false });
    expect(puoDireTuttoTranquillo(stato)).toBe(false);
    expect(stato.attivi.map((s) => s.id)).toEqual(['a']);
    expect(stato.risolti.map((s) => s.id)).toEqual(['b']);
  });

  it('LETTURA FALLITA e niente in mano: MAI il verde', () => {
    const stato = statoDellaConsolle({ dati: undefined, guasto: true, inCorso: false });
    expect(
      puoDireTuttoTranquillo(stato),
      'è il difetto: nessun dato letto diventava «tutto tranquillo»',
    ).toBe(false);
    expect(stato.letturaRiuscita).toBe(false);
    expect(stato.maiLetto).toBe(true);
    expect(stato.inAttesa, 'un guasto non è un’attesa: non va detto «sto leggendo»').toBe(false);
  });

  it('lettura fallita ma con un elenco vecchio in mano: niente verde, e l’SOS resta a schermo', () => {
    // Se qui nascondessimo l'elenco, il numero di telefono e la mappa del
    // fattorino sparirebbero proprio nel momento in cui servono.
    const stato = statoDellaConsolle({ dati: [sos('a', false)], guasto: true, inCorso: false });
    expect(puoDireTuttoTranquillo(stato), 'un elenco vecchio non è una lettura riuscita').toBe(false);
    expect(
      stato.letturaRiuscita,
      'la lettura è fallita ma la consolle la dà per riuscita: da qui torna il verde',
    ).toBe(false);
    expect(stato.maiLetto).toBe(false);
    expect(stato.attivi.map((s) => s.id)).toEqual(['a']);
  });

  it('prima lettura ancora per strada: si dice che si sta guardando, non che va tutto bene', () => {
    const stato = statoDellaConsolle({ dati: undefined, guasto: false, inCorso: true });
    expect(puoDireTuttoTranquillo(stato)).toBe(false);
    expect(stato.inAttesa).toBe(true);
  });

  it('un elenco che non è un elenco (null dal database) vale come non letto', () => {
    const stato = statoDellaConsolle({ dati: null, guasto: false, inCorso: false });
    expect(puoDireTuttoTranquillo(stato)).toBe(false);
    expect(stato.maiLetto).toBe(true);
  });
});

describe('la pagina che sorveglia gli SOS usa quella regola', () => {
  it('la frase verde sta dietro il permesso, non dietro «l’elenco è vuoto»', () => {
    const frase = PAGINA.indexOf('Tutto tranquillo.');
    expect(frase, 'la rassicurazione non è più in pagina: questa prova non sa più cosa guardare').toBeGreaterThan(0);

    // La condizione del ramo che porta alla frase: il `{ … ? (` che la precede.
    const apertura = PAGINA.lastIndexOf('{', PAGINA.lastIndexOf('? (', frase));
    const condizione = PAGINA.slice(apertura + 1, PAGINA.lastIndexOf('? (', frase));
    expect(
      condizione,
      `la frase «Tutto tranquillo» è accesa da: ${condizione.trim()} — un elenco vuoto e una lettura fallita sono la stessa cosa`,
    ).toContain('puoDireTuttoTranquillo(');
    expect(condizione, 'la lunghezza dell’elenco non basta a rassicurare nessuno').not.toMatch(/length\s*===\s*0/);
  });

  it('la lettura solleva l’errore invece di ingoiarlo', () => {
    const inizio = PAGINA.indexOf('queryFn:');
    const fine = PAGINA.indexOf('refetchInterval', inizio);
    expect(inizio).toBeGreaterThan(0);
    const lettura = PAGINA.slice(inizio, fine);
    expect(lettura, 'l’errore non viene nemmeno raccolto dalla risposta').toMatch(/\{\s*data\s*,\s*error\s*\}/);
    expect(lettura, 'l’errore viene raccolto e poi buttato via').toMatch(/throw error/);
  });

  it('quando non ha letto, la pagina lo dice ad alta voce e offre di riprovare', () => {
    expect(PAGINA, 'senza role="alert" l’avviso non viene annunciato a chi non vede').toContain('role="alert"');
    expect(PAGINA).toContain('Non riesco a leggere gli SOS');
    expect(PAGINA).toMatch(/onClick=\{\(\) => refetch\(\)\}/);
  });
});
