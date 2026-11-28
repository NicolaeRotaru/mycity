/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — LA GESTIONE SOCIAL DI SDG È LO STANDARD PER OGNI CLIENTE.
 * Nicola: «Guarda il modo in cui è stato creato la gestione dei social dentro SDG. È stato fatto veramente molto bene
 * e vorrei che venisse usato come base, come standard. Poi va personalizzato in base al cliente, in base ai dati che
 * abbiamo sul cliente, e in base all'abbonamento».
 *
 * Queste prove dicono:
 *  ① il piano di ogni cliente esce nella forma del piano di SDG (lo stesso schema, la stessa pagina);
 *  ② l'abbonamento decide quantità, strati, scheda Google, recensioni e misure, coi numeri del listino;
 *  ③ i dati del cliente decidono obiettivo, a chi parliamo, i profili dei canali e la frase su misura;
 *  ④ il titolare vede la pagina standard, con la sua fascia e «bozza», e mai la nota dell'agente;
 *  ⑤ l'AD sceglie il pilastro di ogni contenuto fra i cinque, e un nome inventato si scarta.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { SocialSchema } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { FASCE } from '@/lib/agenti/fasce';
import { FASCE as LISTINO } from '@/lib/agenzia/preventivo';
import { pianoDelPrimoMese, type PianoDelMese } from '@/lib/agenzia/piano-del-primo-mese';
import { PILASTRI, pilastroDelContenuto, socialDalPiano } from '@/lib/agenzia/social-standard';
import { datiDelClientePerIlPiano, type LavoroDellOrdine } from '@/lib/agenzia/lavoro-dell-ordine';
import { COMPITO_PIANO, SCHEMA_PIANO, TETTI_FLUSSO_14, datiPerIlPianoCompleto, pianoDallaRisposta } from '@/lib/agenzia/piano-completo-ad';
import LavoroDellOrdineDelTitolare from '@/components/seller/lavoro-consegnato/LavoroDellOrdine';

const FASCE_ID = ['base', 'business', 'premium'] as const;
const piano = (fascia: (typeof FASCE_ID)[number], tipo: 'bar' | 'ristorante' = 'bar') =>
  pianoDelPrimoMese({ nome: 'Caffè di Prova', tipo, fascia, citta: 'Piacenza', indirizzo: 'Via Roma 1', accettatoIl: '2026-11-28T10:00:00+01:00' });

describe('① e ② la forma di SDG, misurata sull’abbonamento', () => {
  it.each(FASCE_ID)('%s: lo schema del piano di SDG, le quantità e gli strati del listino', (fascia) => {
    const s = socialDalPiano(piano(fascia), { nome: 'Caffè di Prova', fascia, tipo: 'bar', citta: 'Piacenza' });
    const letto = SocialSchema.safeParse(s);
    expect(letto.success, letto.success ? '' : JSON.stringify(letto.error.issues.slice(0, 3))).toBe(true);

    const feed = s.calendario.filter((c) => c.formato !== 'Storia');
    expect(feed.length).toBe(FASCE[fascia].post);
    expect(feed.filter((c) => c.formato === 'Reel').length).toBe(FASCE[fascia].video);
    expect(s.quantita[0]).toEqual({ voce: 'Contenuti nel mese (post, caroselli e video)', quanti: FASCE[fascia].post });

    // Lo strato: il Base dà 8, il Business ne aggiunge 4 (di cui i 2 video), il Premium il resto.
    const conta = (st: string) => s.calendario.filter((c) => c.strato === st).length;
    const atteso = { base: [8, 0, 0], business: [8, 4, 0], premium: [8, 4, 8] }[fascia];
    expect([conta('base'), conta('business'), conta('premium')]).toEqual(atteso);
    expect(s.calendario.filter((c) => c.strato === 'base').every((c) => c.formato !== 'Reel')).toBe(true);

    // I pilastri sono contati sul calendario vero e fanno 100.
    expect(s.pilastri.reduce((t, p) => t + p.percentuale, 0)).toBe(100);
    expect(s.pilastri.every((p) => (PILASTRI as readonly string[]).includes(p.nome))).toBe(true);

    // Cosa comprende l'abbonamento oltre il calendario: la riga del listino, mai scritta a mano.
    expect(s.extra_premium[0].cosa).toBe(LISTINO[fascia].servizi.social);
    expect(s.titolo_extra).toBe(`Compreso nel ${FASCE[fascia].nome}, oltre il calendario`);
    expect(s.titolo).toContain(`Piano editoriale ${FASCE[fascia].nome} di Caffè di Prova`);
  });

  it('solo il Premium mette i post anche sulla scheda Google, uno a settimana', () => {
    const premium = socialDalPiano(piano('premium'), { nome: 'X', fascia: 'premium' });
    const suGoogle = premium.calendario.filter((c) => c.canale.includes('Scheda Google'));
    expect(suGoogle.length).toBe(4);
    expect(premium.quantita).toContainEqual({ voce: 'Post anche sulla scheda Google', quanti: 4 });
    for (const f of ['base', 'business'] as const) {
      expect(socialDalPiano(piano(f), { nome: 'X', fascia: f }).calendario.some((c) => c.canale.includes('Scheda Google'))).toBe(false);
    }
  });

  it('le recensioni e la misura dei video arrivano col Business; il Base non le promette', () => {
    const base = socialDalPiano(piano('base'), { nome: 'X', fascia: 'base' });
    const business = socialDalPiano(piano('business'), { nome: 'X', fascia: 'business' });
    expect(base.extra_premium.map((e) => e.voce)).not.toContain('Le risposte alle recensioni');
    expect(business.extra_premium.map((e) => e.voce)).toContain('Le risposte alle recensioni');
    expect(base.misure.map((m) => m.kpi)).not.toContain('Quanto guardano i video');
    expect(business.misure.map((m) => m.kpi)).toContain('Quanto guardano i video');
    expect(base.regole.join(' ')).not.toMatch(/musica/i);
  });

  it('nessun numero inventato negli obiettivi delle misure', () => {
    const s = socialDalPiano(piano('premium'), { nome: 'X', fascia: 'premium' });
    for (const m of s.misure) expect(m.obiettivo).not.toMatch(/\d/);
  });

  it('niente di quello che SDG aveva solo per sé: pubblicità, LinkedIn, TikTok, lista WhatsApp', () => {
    const s = socialDalPiano(piano('premium'), { nome: 'X', fascia: 'premium' });
    const tutto = JSON.stringify(s);
    expect(s.canali.map((c) => c.nome)).toEqual(['Instagram', 'Facebook', 'Scheda Google']);
    expect(tutto).not.toMatch(/LinkedIn|TikTok|Lista WhatsApp|Pubblicità su Meta|creator/i);
  });
});

describe('③ cucito sul cliente', () => {
  it('nome, città e tipo cambiano obiettivo e a chi parliamo', () => {
    const bar = socialDalPiano(piano('base'), { nome: 'Caffè di Prova', fascia: 'base', tipo: 'bar', citta: 'Fiorenzuola' });
    const ristorante = socialDalPiano(piano('base', 'ristorante'), { nome: 'Trattoria Prova', fascia: 'base', tipo: 'ristorante', citta: 'Piacenza' });
    expect(bar.obiettivo).toContain('Caffè di Prova');
    expect(bar.obiettivo).toContain('Fiorenzuola');
    expect(ristorante.obiettivo).toContain('tavoli di Trattoria Prova');
    expect(bar.a_chi_parliamo).not.toBe(ristorante.a_chi_parliamo);
  });

  it('i profili trovati dall’analisi diventano l’account; quelli non trovati non sono mai «da aprire»', () => {
    const s = socialDalPiano(piano('business'), {
      nome: 'X', fascia: 'business',
      canaliTrovati: [{ canale: 'Instagram', fonte: 'https://www.instagram.com/caffe_di_prova/' }, { canale: 'Facebook', fonte: null }],
    });
    const per = Object.fromEntries(s.canali.map((c) => [c.nome, c]));
    expect(per.Instagram.account).toBe('instagram.com/caffe_di_prova');
    expect(per.Facebook.account).toBe('trovato, da collegare alla visita');
    expect(per['Scheda Google'].account).toBe('da collegare alla visita');
    expect(s.canali.every((c) => c.da_aprire === false)).toBe(true);
  });

  it('la frase su misura del preventivo entra nell’obiettivo; gli hashtag e «prima di pubblicare» nelle regole', () => {
    const p = piano('business');
    const s = socialDalPiano(p, { nome: 'X', fascia: 'business', suMisura: 'Il profilo di oggi pubblica una volta al mese: tre post a settimana, con le torte.' });
    expect(s.obiettivo).toContain('Su misura per te: Il profilo di oggi pubblica una volta al mese');
    expect(s.regole.join(' ')).toContain(p.intestazione.hashtag);
    expect(s.regole.join(' ')).toContain(`Prima di pubblicare: ${p.intestazione.primaDiPubblicare}`);
    expect(s.tono).toBe(p.intestazione.canaliETono);
  });

  it('un piano a metà (ordine vecchio, piano senza periodo) non rompe la pagina', () => {
    const s = socialDalPiano({ contenuti: [] } as unknown as PianoDelMese, { nome: 'Bar Vecchio', fascia: 'business' });
    expect(s.calendario).toEqual([]);
    expect(s.titolo).toBe('Piano editoriale Business di Bar Vecchio');
    expect(SocialSchema.safeParse(s).success).toBe(true);
    expect(() => socialDalPiano(null, { nome: '', fascia: 'premium' })).not.toThrow();
  });

  it('l’evento in città con la sua fonte resta nel calendario; senza fonte https no', () => {
    const p = piano('base');
    p.contenuti[0] = { ...p.contenuti[0], inCitta: 'Mercato del sabato', fonteEvento: 'https://www.comune.piacenza.it/mercati' };
    p.contenuti[1] = { ...p.contenuti[1], inCitta: 'Sagra inventata', fonteEvento: 'http://nonsicuro.it' };
    const s = socialDalPiano(p, { nome: 'X', fascia: 'base' });
    expect(s.calendario[0]).toMatchObject({ in_citta: 'Mercato del sabato', fonte_evento: 'https://www.comune.piacenza.it/mercati', pilastro: 'Il mese in città' });
    expect(s.calendario[1].in_citta).toBeUndefined();
  });
});

describe('④ la pagina del titolare', () => {
  const accesi: Root[] = [];
  afterEach(() => { for (const r of accesi.splice(0)) act(() => r.unmount()); document.body.innerHTML = ''; });
  async function monta(el: React.ReactElement) {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const d = document.createElement('div');
    document.body.appendChild(d);
    const root = createRoot(d);
    accesi.push(root);
    await act(async () => { root.render(el); });
    return d;
  }
  const ordine = (fascia: (typeof FASCE_ID)[number], stato: 'pronto' | 'in_preparazione' = 'pronto'): LavoroDellOrdine => ({
    fascia, servizi: null, nomeAttivita: 'Caffè di Prova',
    piano: { stato, piano: piano(fascia) },
    sito: { stato: 'lo_stiamo_preparando', bozza: null, indirizzo: null },
    analisi: { stato: 'lo_stiamo_preparando', analisi: null },
    perLoStandard: { tipo: 'bar', citta: 'Piacenza', canaliTrovati: null, suMisura: null },
  });

  it('il Premium del cliente ha le parti del piano di SDG, con la sua fascia e «bozza»', async () => {
    const r = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'social', ordine: ordine('premium') }));
    const t = r.textContent ?? '';
    for (const parte of ['Obiettivo.', 'A chi parliamo.', 'I canali', 'I pilastri: di cosa parliamo', 'Quanto esce nel mese', 'Il calendario', 'Compreso nel Premium, oltre il calendario', 'Come misuriamo', 'Le regole']) {
      expect(t, parte).toContain(parte);
    }
    expect(t).toContain('Premium · Bozza, la confermiamo insieme alla visita');
    expect(t).not.toContain('lavoro consegnato');
    expect(t).not.toContain('Extra Premium');
    expect(t).toContain('Strato Business');
    expect(t).toContain('Versione completa, scritta per la tua attività.');
    expect(r.querySelectorAll('details').length).toBe(20);
    expect(r.querySelector('#piano-filtro')).not.toBeNull();
  });

  it('nel Base non si scrive lo strato (direbbe sempre «Base»), e la prima versione lo dice', async () => {
    const r = await monta(createElement(LavoroDellOrdineDelTitolare, { parte: 'social', ordine: ordine('base', 'in_preparazione') }));
    const t = r.textContent ?? '';
    expect(t).not.toContain('Strato');
    expect(t).toContain('Prima versione, con gli esempi per il tuo tipo di attività.');
    expect(r.querySelectorAll('details').length).toBe(8);
  });

  it('dai dati dell’attività escono solo i quattro dati del piano: mai la nota dell’agente, mai un indirizzo non https', () => {
    const d = datiDelClientePerIlPiano({
      tipo: 'bar', citta: 'Piacenza', notaAgente: 'chiamare dopo le 18, è diffidente', dettaglio: 'bar tabacchi',
      dallaScheda: { social: [{ canale: 'Instagram', fonte: 'javascript:alert(1)' }, { canale: 'Facebook', fonte: 'https://facebook.com/x' }], servizi: { social: 'Tre post a settimana.', sito_web: 'altro' }, perche: 'interno' },
    });
    expect(d).toEqual({ tipo: 'bar', citta: 'Piacenza', canaliTrovati: [{ canale: 'Instagram', fonte: null }, { canale: 'Facebook', fonte: 'https://facebook.com/x' }], suMisura: 'Tre post a settimana.' });
    expect(JSON.stringify(d)).not.toMatch(/diffidente|tabacchi|interno/);
    expect(datiDelClientePerIlPiano({ tipo: 'casinò' }).tipo).toBeNull();
    expect(datiDelClientePerIlPiano(null)).toEqual({ tipo: null, citta: null, canaliTrovati: null, suMisura: null });
  });
});

describe('⑤ l’AD sceglie il pilastro fra i cinque', () => {
  it('il compito e i dati portano i pilastri del tipo di attività, sotto il tetto del flusso 14', () => {
    expect(COMPITO_PIANO).toMatch(/LO STANDARD è il piano social di SDG Agenzia/);
    expect(SCHEMA_PIANO.properties.contenuti.items.properties).toHaveProperty('pilastro');
    const p = piano('premium');
    const dati = datiPerIlPianoCompleto({ nome: 'X', tipo: 'Bar e pasticceria', citta: 'Piacenza', indirizzo: null, fascia: 'premium', piano: p, scheda: null, tipoAttivita: 'bar' }) as { pilastri?: { nome: string }[] };
    expect(dati.pilastri?.map((x) => x.nome)).toEqual([...PILASTRI]);
    expect(JSON.stringify({ compito: COMPITO_PIANO, dati, schema: SCHEMA_PIANO }).length).toBeLessThanOrEqual(TETTI_FLUSSO_14.richiesta);
    expect(COMPITO_PIANO.length).toBeLessThanOrEqual(TETTI_FLUSSO_14.compito);
  });

  it('il pilastro dell’AD vince sul tema; un nome inventato si scarta e decide il tema', () => {
    const p = piano('base');
    const risposta = {
      intestazione: { canali_e_tono: 'Instagram e Facebook, tono cordiale', hashtag: '#Piacenza', prima_di_pubblicare: 'Confermare gli orari col titolare.' },
      contenuti: p.contenuti.map((c, i) => ({
        data: c.data, ora: c.ora, tipo: c.tipo, tema: i === 0 ? 'Ordina da casa' : c.tema, didascalia: 'Una didascalia semplice. #Piacenza',
        cosa_riprendere: 'Una foto verticale.', in_citta: null, fonte_evento: null,
        pilastro: i === 0 ? 'Dietro le quinte' : i === 1 ? 'Sconti pazzi' : undefined,
      })),
      note: [],
    };
    const esito = pianoDallaRisposta(risposta, p, 'base');
    expect(esito.ok, esito.ok ? '' : esito.motivo).toBe(true);
    if (!esito.ok) return;
    expect(esito.piano.contenuti[0].pilastro).toBe('Dietro le quinte');
    expect(esito.piano.contenuti[1].pilastro).toBeNull();
    const s = socialDalPiano(esito.piano, { nome: 'X', fascia: 'base' });
    expect(s.calendario[0].pilastro).toBe('Dietro le quinte');
    expect(s.calendario[1].pilastro).toBe(pilastroDelContenuto({ tema: p.contenuti[1].tema }));
    expect(JSON.stringify(s)).not.toContain('Sconti pazzi');
  });

  it('i temi del piano del sito finiscono ognuno nel suo pilastro', () => {
    expect(pilastroDelContenuto({ tema: 'Il tema del mese, a domicilio' })).toBe('La vetrina MyCity');
    expect(pilastroDelContenuto({ tema: 'Il tema del mese: Natale e i regali' })).toBe('Il mese in città');
    expect(pilastroDelContenuto({ tema: 'Un grazie a chi lavora con noi' })).toBe('Dietro le quinte');
    expect(pilastroDelContenuto({ tema: 'La domanda ai clienti' })).toBe('Clienti e quartiere');
    expect(pilastroDelContenuto({ tema: 'I più scelti della settimana' })).toBe('Quello che offriamo');
  });
});
