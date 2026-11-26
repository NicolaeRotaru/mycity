// Gli agenti dentro MyCity (26/11/2026): i prezzi della scheda vengono dal listino del sito, gli inviti hanno la
// forma giusta, e il corpo che il sito manda a n8n passa dal nodo vero che lo riceve (prova di contratto).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FASCE as LISTINO } from '@/lib/agenzia/preventivo';
import { FASCE, ID_FASCE } from '@/lib/agenti/fasce';
import { CODICE_INVITO, improntaCodice, nuovoCodice, statoInvito } from '@/lib/agenti/inviti';
import { corpoLavoro } from '@/lib/agenti/n8n';
import { primaScheda } from '@/lib/agenti/scheda';
import { COMPITO, SCHEMA, FLUSSO, datiPerAd } from '@/lib/agenti/compito';
import { leggiIndirizzoGoogle } from '@/lib/agenti/link';

test('la scheda dell’agente usa i prezzi del listino del sito, non una copia', () => {
  assert.deepEqual(ID_FASCE, Object.keys(LISTINO));
  for (const id of ID_FASCE) {
    assert.equal(FASCE[id].centesimi, LISTINO[id].prezzoMese, id);
    assert.equal(FASCE[id].nome, LISTINO[id].nome, id);
  }
  assert.deepEqual([FASCE.base.post, FASCE.business.post, FASCE.premium.post], [8, 12, 20]);
  assert.deepEqual([FASCE.base.video, FASCE.business.video, FASCE.premium.video], [0, 2, 4]);
});

test('il codice d’invito: 256 bit casuali, nel database solo l’impronta', () => {
  const a = nuovoCodice();
  const b = nuovoCodice();
  assert.match(a, CODICE_INVITO);
  assert.notEqual(a, b);
  assert.match(improntaCodice(a), /^[0-9a-f]{64}$/);
  assert.notEqual(improntaCodice(a), a);
  assert.equal(CODICE_INVITO.test('../../etc/passwd'), false);
  assert.equal(CODICE_INVITO.test(a + 'x'), false);
});

test('lo stato di un invito: valido, usato, scaduto, ritirato', () => {
  const adesso = Date.parse('2026-11-26T20:00:00Z');
  const base = { scade_il: '2026-12-10T20:00:00Z', usi: 0, usi_max: 1, ritirato_il: null };
  assert.equal(statoInvito(base, adesso), 'valido');
  assert.equal(statoInvito({ ...base, usi: 1 }, adesso), 'usato');
  assert.equal(statoInvito({ ...base, scade_il: '2026-11-26T19:59:00Z' }, adesso), 'scaduto');
  assert.equal(statoInvito({ ...base, ritirato_il: '2026-11-26T19:00:00Z' }, adesso), 'ritirato');
  assert.equal(statoInvito(null, adesso), 'inesistente');
});

const NODO = path.resolve(__dirname, '..', '..', '..', '..', 'N8N', 'flussi', '14-scheda-venditore', 'codice', 'controlla-lavoro.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...x: unknown[]) => Promise<Array<{ json: Record<string, unknown> }>>;

test.skipIf(!fs.existsSync(NODO))('contratto: il corpo che MyCity manda passa da «Controlla il lavoro» del flusso 14 (repo N8N accanto)', async () => {
  const letto = leggiIndirizzoGoogle('https://www.google.com/maps?q=La+Dolce+Dispensa,+Via+Bianchi,+27,+29122+Piacenza+PC');
  const prima = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: '2026-11-26 21:00' });
  const corpo = JSON.parse(JSON.stringify(corpoLavoro('1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'agente@esempio.it', prima.nome, prima,
    { flusso: FLUSSO, compito: COMPITO, schema: SCHEMA, dati: datiPerAd({ prima, osm: null, misura: null, giorno: '2026-11-26' }) })));
  const $ = (nome: string) => ({ first: () => (nome === 'Dal sito del venditore' ? { json: { body: corpo } } : undefined) });
  const [esito] = await new AsyncFunction('$', fs.readFileSync(NODO, 'utf8'))($);
  assert.equal(esito.json.valido, true, String(esito.json.motivo));
  assert.equal(esito.json.venditore, 'agente@esempio.it');
});
