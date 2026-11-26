// @ts-nocheck — prove portate dal sito venditore (26/11/2026): i dati finti non portano i tipi.
// I paletti sulla risposta dell'AD, con le frasi vere che il collaudo del 26/11 aveva fatto passare.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { negaIlDieciPerCento, GIOCO_TABACCO, pulisci } from '@/lib/agenti/scheda';

test('tutti i modi di dire «niente percentuale» trovati dal collaudo vengono fermati', () => {
  for (const f of ['zero commissioni', 'non vi chiediamo il 10%', 'senza alcuna percentuale', 'senza nessuna commissione', 'niente commissioni',
    'nessuna provvigione', 'commissioni zero', '0% di commissione', 'con l’abbonamento il 10% non c’è più', 'non c’è nessuna percentuale',
    "non c'è nessuna percentuale", 'non prendiamo percentuali', 'Nessuna Percentuale', 'nessuna percentuale', 'non pagate nessuna commissione'])
    assert.equal(negaIlDieciPerCento(f), true, f);
});

test('le frasi giuste passano: l’avviso «mai dire…» e le vendite al banco', () => {
  for (const f of ['Il 10% resta anche con l’abbonamento: dillo subito, mai «nessuna percentuale».', 'Mai scrivere «zero commissioni».',
    'Su quello che vendete al banco non prendiamo nessuna percentuale; sui prodotti venduti tramite MyCity c’è il 10%.',
    'Il 10% sui prodotti venduti tramite MyCity resta anche con l’abbonamento.'])
    assert.equal(negaIlDieciPerCento(f), false, f);
});

test('gioco e tabacco: le parole trovate dal collaudo vengono fermate, «slot di consegna» e «lotto di produzione» no', () => {
  for (const f of ['Post per Gratta & Vinci', 'Gratta&Vinci', 'Lottomatica', '10eLotto', 'SNAI', 'Eurobet', 'punto scommesse', 'ricevitoria',
    'IQOS e heets', 'sigari toscani', 'sala bingo', 'poker online', 'VLT', 'tabaccheria', 'slot machine nuove', 'giocate al lotto'])
    assert.equal(GIOCO_TABACCO.test(f), true, f);
  for (const f of ['slot di consegna pieno', 'lotto di produzione', 'Il venerdì lo slot per il ritiro è libero'])
    assert.equal(GIOCO_TABACCO.test(f), false, f);
});

test('ogni campo dell’AD passa dai controlli: nessuna frase vietata arriva al venditore', () => {
  const r = pulisci({
    tipo: 'Tabaccheria, zero commissioni', consigliato: 'business', perche_consigliato: 'Per spingere le scommesse sportive',
    in_30_secondi: ['Proponi post sulle slot machine nuove', 'Non vi chiediamo il 10%', 'Bar storico.'], gancio: 'Promo gratta e vinci', ha: ['Ricevitoria in negozio', 'Bancone lungo'],
    domande: ['Avete Instagram? Tanto nessuna percentuale.', 'Chi fa le foto?'], reputazione: { sintesi: 'nessuna percentuale', positivi: ['Caffè buono'], negativi: [] },
    obiezioni: [{ obiezione: 'Prendete una percentuale? No, nessuna percentuale', risposta: 'x' }, { obiezione: 'Ho poco tempo', risposta: 'Promuoviamo le sigarette elettroniche' }],
    campi: [{ voce: 'Offerta', valore: 'Promo, nessuna percentuale', stato: 'confermato', fonte: 'https://x.it' }],
    social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/x/', giudizio: 'pubblica poco; niente commissioni', livello: 'debole' }],
    sito: { livello: 'medio', giudizio: 'Sito curato, commissioni zero', fonte: 'https://x.it' },
    attenzione: ['Il 10% resta: mai «nessuna percentuale».'], potenziale: ['Colazioni del sabato', 'Spingere i 10eLotto'], migliorare: ['Promuovere le scommesse'],
  });
  assert.equal(r.tipo, undefined);
  assert.equal(r.perche_consigliato, null);
  assert.deepEqual(r.in_30_secondi, ['Bar storico.']);
  assert.equal(r.gancio, null);
  assert.deepEqual(r.ha, ['Ricevitoria in negozio', 'Bancone lungo'], '«ha» descrive: la ricevitoria è un fatto, non una proposta');
  assert.deepEqual(r.domande, ['Chi fa le foto?']);
  assert.equal(r.reputazione.sintesi, null);
  assert.equal(r.obiezioni.length, 0);
  assert.equal(r.campi.length, 0);
  assert.equal(r.social[0].giudizio, null);
  assert.equal(r.sito.giudizio, null);
  assert.deepEqual(r.attenzione, ['Il 10% resta: mai «nessuna percentuale».']);
  assert.deepEqual(r.potenziale, ['Colazioni del sabato']);
  assert.deepEqual(r.migliorare, []);
  assert.ok(r.scartati.length >= 12);
});

test('dati di persone ed email fuori; il nome dell’attività non lo cambia l’AD', () => {
  const r = pulisci({ campi: [
    { voce: 'Nome', valore: 'Bar Prova di Mario Rossi', stato: 'confermato', fonte: 'https://x.it' },
    { voce: 'Titolare', valore: 'Mario Rossi', stato: 'confermato', fonte: 'https://x.it' },
    { voce: 'Contatti', valore: 'scrivete a mario.rossi@gmail.com', stato: 'confermato', fonte: 'https://x.it' },
    { voce: 'Anno di apertura', valore: '1998', stato: 'da_confermare', fonte: 'https://x.it/storia' },
  ] });
  assert.deepEqual(r.campi.map((c) => c.voce), ['Anno di apertura']);
  assert.ok(r.scartati.some((s) => /persone/.test(s)) && r.scartati.some((s) => /email/.test(s)));
});
