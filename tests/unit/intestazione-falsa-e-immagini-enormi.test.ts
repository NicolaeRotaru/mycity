import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/rate-limit';
import { leggiConTetto } from '@/lib/products/rehostImages';

/**
 * Due difese che si aggiravano da fuori.
 *
 * 1. Il limite sui tentativi di accesso contava per indirizzo di rete, ma
 *    l'indirizzo lo leggeva dal PRIMO pezzo di `x-forwarded-for` — cioè da
 *    quello che scrive il chiamante. Bastava mandare un numero diverso a ogni
 *    richiesta per avere un contatore nuovo ogni volta.
 *
 * 2. Il tetto di 8 MiB sulle immagini importate si controllava DOPO aver messo
 *    il file interamente in memoria. Un URL che punta a un file enorme — e
 *    l'URL lo scrive il venditore — poteva saturare la RAM del server.
 */

function richiestaCon(headers: Record<string, string>): Request {
  return new Request('https://mycity.test/api/auth/signin', { method: 'POST', headers });
}

describe('da quale indirizzo arriva la richiesta', () => {
  it('ignora il valore inventato dal chiamante e prende quello scritto dal nostro proxy', () => {
    // Il chiamante scrive "1.2.3.4"; il proxy aggiunge in coda l'indirizzo vero.
    const ip = getClientIp(richiestaCon({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }));
    expect(ip).toBe('203.0.113.7');
  });

  it('due richieste con intestazione inventata diversa finiscono nello stesso contatore', () => {
    const primo = getClientIp(richiestaCon({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }));
    const secondo = getClientIp(richiestaCon({ 'x-forwarded-for': '8.8.8.8, 203.0.113.7' }));
    // Prima erano '9.9.9.9' e '8.8.8.8': due contatori distinti, limite aggirato.
    expect(primo).toBe(secondo);
  });

  it('con un solo pezzo nella catena usa quello', () => {
    expect(getClientIp(richiestaCon({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('senza x-forwarded-for ricade su x-real-ip', () => {
    expect(getClientIp(richiestaCon({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('senza nessuna intestazione non inventa un indirizzo', () => {
    expect(getClientIp(richiestaCon({}))).toBe('unknown');
  });
});

describe('tetto sulla dimensione delle immagini importate', () => {
  function rispostaAPezzi(pezzi: Uint8Array[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of pezzi) controller.enqueue(p);
        controller.close();
      },
    });
    // Content-Length dichiarato piccolo: il server remoto mente.
    return new Response(stream, { headers: { 'content-length': '10' } });
  }

  it('si ferma quando il file supera il tetto, anche se il server dichiara pochi byte', async () => {
    const pezzo = new Uint8Array(1024).fill(7);
    const pezzi = Array.from({ length: 40 }, () => pezzo); // 40 KiB veri
    const buf = await leggiConTetto(rispostaAPezzi(pezzi), 8 * 1024); // tetto 8 KiB
    expect(buf).toBeNull();
  });

  it('legge tutto quando il file sta sotto il tetto', async () => {
    const pezzi = [new Uint8Array(100).fill(1), new Uint8Array(200).fill(2)];
    const buf = await leggiConTetto(rispostaAPezzi(pezzi), 8 * 1024);
    expect(buf).not.toBeNull();
    expect(buf!.byteLength).toBe(300);
  });

  it('non tiene in memoria più del tetto: si interrompe a metà lettura', async () => {
    let letti = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        letti += 1;
        controller.enqueue(new Uint8Array(4096).fill(3));
        if (letti > 1000) controller.close();
      },
    });
    const buf = await leggiConTetto(new Response(stream), 8 * 1024);
    expect(buf).toBeNull();
    // Con un tetto di 8 KiB e pezzi da 4 KiB bastano pochi giri: se leggesse
    // tutto lo stream (oltre 4 MB) questo numero sarebbe nell'ordine delle
    // centinaia.
    expect(letti).toBeLessThan(10);
  });
});
