/**
 * R05-007 (collaudo) — IL TESTO SALVATO CON LA PAGINA DEI CONTATTI RESTA CLICCABILE.
 *
 * Il corpo della spiegazione si scrive la notte del pannello; l'email può partire una notte dopo. Se
 * intanto si configura la casella privacy, il testo salvato dice ancora «(pagina /contact)» mentre il
 * recapito di adesso è una casella. L'email deve avere lo stesso il collegamento intero e cliccabile al
 * modulo dei contatti (alla base c'era), senza la parola nuda e senza la stessa strada scritta due
 * volte. Posta e database finti, nessuna rete.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';
import { corpoDellEmail, recapitaAvvisi, type ClienteAvvisi, type PostaAvvisi, type RegistroAvvisi } from '@/lib/privacy/avvisi-a-chi-aspetta';
import { verdettoDelGiro, type TentativoCancellazione } from '@/lib/cron-cancellazioni';

const SITO = 'https://www.mycity-di-prova.it';
const ADESSO = new Date('2026-11-21T04:00:00.000Z').getTime();
const FATTORINO: TentativoCancellazione = {
  userId: 'rider-1',
  ok: false,
  motivo: 'cassa_da_versare',
  errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati e non ancora versati.',
  chiestaIl: new Date(ADESSO - 8 * 86_400_000).toISOString(),
};
const registro = (): RegistroAvvisi => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const quante = (testo: string, pezzo: string) => testo.split(pezzo).length - 1;

/** Il corpo come lo salva il pannello quando la casella privacy non c'è ancora. */
function avvisoSalvatoSenzaCasella() {
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
  process.env.NEXT_PUBLIC_APP_URL = SITO;
  const [a] = verdettoDelGiro([FATTORINO], ADESSO).dovuti;
  expect(a.corpo, 'il testo del pannello senza casella porta la pagina dei contatti').toContain('(pagina /contact)');
  return a;
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
});

describe('R05-007 — il testo salvato con la pagina dei contatti resta cliccabile', () => {
  it('IL CASO — casella privacy configurata dopo il pannello: html e testo hanno il collegamento intero', async () => {
    const avviso = avvisoSalvatoSenzaCasella();
    process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY = 'privacy@mycity-di-prova.it';

    const html = corpoDellEmail(avviso);
    expect(html, 'senza il collegamento la persona legge una parola senza dominio').toContain(`href="${SITO}/contact"`);
    expect(html).not.toContain('(pagina /contact)');

    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const lettere: Array<{ html: string; text?: string }> = [];
    const posta: PostaAvvisi = {
      indirizzoDi: async () => 'rider@example.com',
      invia: async (l) => {
        lettere.push(l);
        return { ok: true };
      },
    };
    await recapitaAvvisi(finto.admin as unknown as ClienteAvvisi, [avviso], registro(), posta, ADESSO);
    expect(lettere).toHaveLength(1);
    expect(lettere[0].text ?? '').toContain(`${SITO}/contact`);
    expect(lettere[0].text ?? '').not.toContain('(pagina /contact)');
  });

  it('senza casella, con la pagina nel testo: il collegamento c è una volta sola, senza la parola nuda', () => {
    const avviso = avvisoSalvatoSenzaCasella();
    const html = corpoDellEmail(avviso);
    expect(quante(html, `href="${SITO}/contact"`), 'la stessa strada non va scritta due volte').toBe(1);
    expect(html).not.toContain('(pagina /contact)');
  });
});
