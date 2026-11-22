/**
 * R05-007 — IL COLLEGAMENTO DELL'EMAIL VIENE DAL RECAPITO, NON DA UNA PAROLA DENTRO LA FRASE.
 *
 * L'email della spiegazione d'attesa trovava il collegamento al modulo dei contatti cercando
 * «/contact» dentro il testo, che però scrive un altro modulo (lib/legal/titolare.ts,
 * `recapitoInUnaFrase`). Se quella frase cambiava parole e perdeva il percorso, l'email restava senza
 * niente da cliccare, e nessuna prova diventava rossa. Qui la frase di titolare cambia davvero (senza
 * il percorso): il collegamento dell'email deve restare giusto, e il testo della spiegazione resta
 * parola per parola quello del pannello. Posta e database finti, nessuna rete.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const FRASE_SENZA_PERCORSO = 'noi con il modulo dei contatti del sito';
vi.mock('@/lib/legal/titolare', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  recapitoInUnaFrase: () => FRASE_SENZA_PERCORSO,
}));

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

function senzaCasella() {
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
  process.env.NEXT_PUBLIC_APP_URL = SITO;
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
});

describe('R05-007 — il collegamento al modulo dei contatti non dipende dalle parole della frase', () => {
  it('IL CASO — la frase di titolare non contiene più il percorso: l email ha lo stesso il collegamento giusto', () => {
    senzaCasella();
    const [a] = verdettoDelGiro([FATTORINO], ADESSO).dovuti;
    expect(a.corpo, 'la frase finta deve essere quella nel testo').toContain(FRASE_SENZA_PERCORSO);
    expect(a.corpo).not.toContain('/contact');

    const html = corpoDellEmail(a);
    expect(html, 'senza il percorso nella frase, l email restava senza collegamento').toContain(`href="${SITO}/contact"`);
  });

  it('nella lettera intera il collegamento c è nell html e nel testo semplice, e il testo del pannello resta quello', async () => {
    senzaCasella();
    const finto = fintoGiroNotturno({ chiaviUniche: true });
    const lettere: Array<{ html: string; text?: string }> = [];
    const posta: PostaAvvisi = {
      indirizzoDi: async () => 'rider@example.com',
      invia: async (l) => {
        lettere.push(l);
        return { ok: true };
      },
    };
    const avvisi = verdettoDelGiro([FATTORINO], ADESSO).dovuti;
    await recapitaAvvisi(finto.admin as unknown as ClienteAvvisi, avvisi, registro(), posta, ADESSO);

    expect(lettere).toHaveLength(1);
    expect(lettere[0].html).toContain(`href="${SITO}/contact"`);
    expect(lettere[0].text ?? '').toContain(`${SITO}/contact`);
    expect(lettere[0].text ?? '', 'il testo della spiegazione è quello del pannello, parola per parola').toContain(avvisi[0].corpo);
  });

  it('con una casella privacy vera l indirizzo è già nel testo: nessun collegamento al modulo inventato', () => {
    process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY = 'privacy@mycity-di-prova.it';
    process.env.NEXT_PUBLIC_APP_URL = SITO;
    const [a] = verdettoDelGiro([FATTORINO], ADESSO).dovuti;
    expect(corpoDellEmail({ ...a, corpo: 'Se pensi che non sia giusto scrivi a privacy@mycity-di-prova.it.' })).not.toContain('/contact');
  });
});
