import { describe, it, expect, vi } from 'vitest';
import { nuovoDb, supabaseFinto, type DbFinto } from './_supabase-finto';

/**
 * COLLAUDO DEL 28/11/2026 — tre buchi trovati provando il lavoro che nasce con l'ordine di SDG.
 *  ① La bozza del sito diceva di scartare gli orari, ma «dalle 7:00 alle 20:00» passava: `fraseMostrabile` guarda
 *     prezzi e contatti, non gli orari.
 *  ② Il piano completo dell'AD ora lo legge il titolare nella sua pagina, senza il controllo di SDG prima, ma non
 *     passava da nessuna regola sui prezzi, i telefoni, i voti di Google o i nomi di persona (solo email e gioco).
 *  ③ La rotta del titolare mandava anche le «note» per il team (del piano e della bozza del sito).
 */

const SELLER = '0de1905e-7000-4000-8000-0000000000aa';
const stato = vi.hoisted(() => ({ db: null as unknown as DbFinto }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => supabaseFinto(stato.db) }));

const { sitoDallaRisposta } = await import('@/lib/agenzia/sito-dell-ordine-ad');
const { pianoDallaRisposta } = await import('@/lib/agenzia/piano-completo-ad');
const { pianoDelPrimoMese } = await import('@/lib/agenzia/piano-del-primo-mese');
const { lavoroDallOrdine } = await import('@/lib/agenzia/lavoro-dell-ordine');

const SEZIONE = { titolo: 'Chi siamo', testo: 'Un bar nel centro della città, per la colazione e per la pausa a metà giornata.', stato: 'da_confermare' as const };
const sito = (testo = SEZIONE.testo) => ({
  sottotitolo: 'Bar e caffetteria in centro',
  pagine: [{ titolo: 'Home', percorso: '/', sezioni: [{ ...SEZIONE, testo }] }],
  da_confermare: [{ voce: 'Orari di apertura', perche: 'non li abbiamo: li scrive il titolare' }],
  fonti: [] as string[],
  note: ['Foto della vetrina alla visita'],
});

describe('① la bozza del sito non porta orari inventati', () => {
  it('una bozza senza orari entra, anche con «Orari: da confermare col titolare»', () => {
    expect(sitoDallaRisposta(sito(), 'base', 'Caffè di Prova').ok).toBe(true);
    expect(sitoDallaRisposta(sito('Orari: da confermare col titolare alla prima visita, insieme al menù del giorno.'), 'base', 'Caffè di Prova').ok).toBe(true);
  });
  it.each([
    'Siamo aperti dal lunedì al sabato dalle 7:00 alle 20:00, la domenica chiusi.',
    'Siamo aperti tutti i giorni dalle 7 alle 20, anche la domenica mattina.',
    'Orario: lun-sab 7-20, domenica chiuso. Vieni a trovarci quando vuoi.',
    'La cucina apre alle ore 12 e la sera si cena fino a tardi con gli amici.',
  ])('scarta «%s»', (t) => {
    expect(sitoDallaRisposta(sito(t), 'base', 'Caffè di Prova')).toMatchObject({ ok: false, motivo: expect.stringContaining('orario') });
  });
});

describe('② il piano dell AD, che il titolare legge, passa dalle stesse regole del sito', () => {
  const partenza = pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia: 'business', visitaIl: '2026-12-03T09:00:00Z', citta: 'Piacenza' });
  const buono = () => ({
    intestazione: { canali_e_tono: 'Instagram e Facebook, tono cordiale', hashtag: '#Piacenza #CaffèDiProva', prima_di_pubblicare: 'Confermare col titolare orari, telefono, prodotti e prezzi' },
    contenuti: partenza.contenuti.map((c, i) => ({ data: c.data, ora: c.ora, tipo: c.tipo, tema: `Tema ${i}`, didascalia: `Buongiorno dal Caffè di Prova, la colazione ti aspetta ${i} #Piacenza`, cosa_riprendere: 'Video verticale 9:16 di 15-20 secondi, 5 clip da 3 secondi', in_citta: null as string | null, fonte_evento: null as string | null })),
    note: ['Foto del bancone alla visita'],
  });
  const con = (f: (r: ReturnType<typeof buono>) => void, p = partenza) => { const r = buono(); f(r); return pianoDallaRisposta(r, p, 'business'); };

  it('quello giusto entra, anche con un evento in città con l ora', () => {
    expect(con(() => undefined).ok).toBe(true);
    expect(con((r) => { r.contenuti[0].in_citta = 'Mercato del sabato, dalle 8 alle 13 in Piazza Duomo'; r.contenuti[0].fonte_evento = 'https://www.comune.piacenza.it/mercato'; }).ok).toBe(true);
    // Un orario coi minuti non è un prezzo, e il profilo del locale nell'intestazione è suo (come nel piano del 27/11).
    expect(con((r) => { r.contenuti[0].in_citta = 'Concerto in Piazza Cavalli alle 21.00'; r.contenuti[0].fonte_evento = 'https://www.comune.piacenza.it/eventi'; }).ok).toBe(true);
    expect(con((r) => { r.intestazione.canali_e_tono = 'Instagram @caffe_di_prova e Facebook, tono cordiale'; }).ok).toBe(true);
  });
  it('il nome del locale non conta, anche se sembra un nome di persona', () => {
    const mario = pianoDelPrimoMese({ nome: 'Pizzeria Mario Rossi', tipo: 'ristorante', fascia: 'business', visitaIl: '2026-12-03T09:00:00Z' });
    const r = buono();
    r.contenuti = mario.contenuti.map((c) => ({ ...r.contenuti[0], data: c.data, ora: c.ora, tipo: c.tipo, didascalia: 'Stasera alla Pizzeria Mario Rossi si accende il forno a legna' }));
    expect(pianoDallaRisposta(r, mario, 'business').ok).toBe(true);
  });
  it.each([
    ['un prezzo', (r: ReturnType<typeof buono>) => { r.contenuti[1].didascalia = 'Colazione completa a 3,50 € tutte le mattine'; }],
    ['un prezzo a parole', (r: ReturnType<typeof buono>) => { r.contenuti[1].didascalia = 'Il menù pranzo costa dodici euro, bevanda compresa'; }],
    ['un telefono', (r: ReturnType<typeof buono>) => { r.contenuti[2].didascalia = 'Prenota il tuo tavolo al 0523 123456'; }],
    ['un indirizzo web', (r: ReturnType<typeof buono>) => { r.contenuti[2].cosa_riprendere = 'Riprendere la vetrina e mettere il link www.caffediprova.it'; }],
    ['un voto di Google', (r: ReturnType<typeof buono>) => { r.contenuti[3].tema = 'Grazie per le 4,6 stelle su Google'; }],
    ['un conto di recensioni', (r: ReturnType<typeof buono>) => { r.contenuti[3].didascalia = 'Grazie per le 120 recensioni, siete fantastici'; }],
    ['un nome di persona', (r: ReturnType<typeof buono>) => { r.contenuti[4].didascalia = 'Ti accoglie Mario Rossi con un sorriso ogni mattina'; }],
    ['un @profilo', (r: ReturnType<typeof buono>) => { r.contenuti[4].didascalia = 'Grazie a @giulia.b per la foto della colazione'; }],
    ['un prezzo nelle note', (r: ReturnType<typeof buono>) => { r.note = ['Il titolare paga 30 euro in più per le storie']; }],
  ])('%s no', (_n, f) => {
    expect(con(f)).toMatchObject({ ok: false });
  });
});

describe('③ al titolare non arrivano le note per il team', () => {
  it('piano e bozza del sito senza «note», il resto sì', async () => {
    stato.db = nuovoDb();
    const e = sitoDallaRisposta({ ...sito(), note: ['NOTA-DEL-TEAM-SITO'] }, 'base', 'Caffè di Prova');
    if (!e.ok) throw new Error(e.motivo);
    stato.db.tabelle.ordini_sdg = [{
      id: 'o1', seller_id: SELLER, nome_attivita: 'Caffè di Prova', fascia: 'base', dati_attivita: null,
      piano: { ...pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo: 'bar', fascia: 'base' }), note: ['NOTA-DEL-TEAM-PIANO'] }, piano_completo_stato: 'pronto',
      sito: e.sito, sito_stato: 'pronto', analisi: null, analisi_stato: 'da_collegare',
    }];
    const visto = await lavoroDallOrdine(SELLER);
    expect(visto?.sito.bozza?.pagine).toHaveLength(1);
    expect(visto?.piano.piano.contenuti.length).toBeGreaterThan(0);
    expect(JSON.stringify(visto)).not.toMatch(/NOTA-DEL-TEAM/);
  });
});
