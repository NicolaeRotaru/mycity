import { describe, it, expect } from 'vitest';
import { leggiCorpoConTetto, jsonConTetto, richiestaConTetto } from '@/lib/api/corpo';

/**
 * #180 — Il tetto sulla dimensione del corpo si aggirava omettendo
 * un'intestazione.
 *
 * Il controllo leggeva `content-length`, che la manda chi chiama: ometterla, o
 * dichiarare un numero più piccolo del vero, bastava per saltarlo — e poi il
 * corpo veniva caricato tutto in memoria. Un solo utente poteva far cadere
 * l'istanza, e con lei il sito per tutti.
 *
 * Queste prove mandano corpi grandi SENZA `content-length` (uno stream non ce
 * l'ha): col controllo vecchio passerebbero tutti.
 */

function richiestaStream(byte: number, contentLength?: string) {
  const pezzo = new Uint8Array(1024).fill(65);
  let mandati = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (mandati >= byte) { controller.close(); return; }
      controller.enqueue(pezzo.slice(0, Math.min(1024, byte - mandati)));
      mandati += 1024;
    },
  });
  const headers = new Headers();
  if (contentLength) headers.set('content-length', contentLength);
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers,
    body: stream,
    // @ts-expect-error duplex serve a Node per i corpi in streaming
    duplex: 'half',
  });
}

describe('il tetto sul corpo della richiesta', () => {
  it('si ferma davvero quando il corpo supera il limite', async () => {
    const buf = await leggiCorpoConTetto(richiestaStream(200 * 1024), 64 * 1024);
    expect(buf).toBeNull();
  });

  it('non si fida di content-length: un corpo grande dichiarato piccolo viene fermato', async () => {
    const buf = await leggiCorpoConTetto(richiestaStream(200 * 1024, '10'), 64 * 1024);
    expect(buf).toBeNull();
  });

  it('un corpo dentro il limite passa intero', async () => {
    const buf = await leggiCorpoConTetto(richiestaStream(4 * 1024), 64 * 1024);
    expect(buf?.byteLength).toBe(4 * 1024);
  });

  it('il JSON troppo grande torna undefined, quello rotto torna null', async () => {
    expect(await jsonConTetto(richiestaStream(200 * 1024), 64 * 1024)).toBeUndefined();
    const rotto = new Request('http://localhost/api/x', { method: 'POST', body: '{ non json' });
    expect(await jsonConTetto(rotto, 64 * 1024)).toBeNull();
  });

  it('il JSON valido dentro il limite si legge', async () => {
    const ok = new Request('http://localhost/api/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    expect(await jsonConTetto(ok, 64 * 1024)).toEqual({ a: 1 });
  });

  it('la richiesta ricostruita resta leggibile come modulo', async () => {
    const form = new FormData();
    form.set('kind', 'id_front');
    const originale = new Request('http://localhost/api/x', { method: 'POST', body: form });
    const rifatta = await richiestaConTetto(originale, 1024 * 1024);
    expect(rifatta).not.toBeNull();
    expect((await rifatta!.formData()).get('kind')).toBe('id_front');
  });
});
