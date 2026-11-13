/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { TABELLE_CON_DATI_PERSONALI } from '@/lib/account/cancellazione';

/**
 * R21-010 — L'INFORMATIVA NON DICEVA QUANTO TENIAMO I MESSAGGI DELLA CHAT.
 *
 * La tabella «Finalità, basi giuridiche e conservazione» non aveva una riga per la chat col negozio:
 * nessuna base giuridica e nessun tempo (art. 13.2.a). La riga dei Contatti c'è dal 5/11.
 *
 * La prova monta la pagina vera e legge la riga della chat. Il tempo che dichiara non lo prende
 * per buono: lo confronta con quello che fa il codice, cioè che i messaggi cadono insieme
 * all'account di chi li ha scritti (cancellazione e vincolo del database).
 */

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Pagina = (await monta('app/privacy/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

describe('R21-010 · la chat col negozio ha la sua riga, e dice quello che il codice fa', () => {
  it('IL CASO CHE ROMPEVA — nella tabella c è la riga della chat, con base giuridica e tempo', () => {
    const s = accendi(Pagina);
    try {
      const righe = Array.from(s.radice.querySelectorAll('#finalita tbody tr'));
      expect(righe.length, 'la tabella non è comparsa: la prova non sta guardando niente').toBeGreaterThan(5);
      const riga = righe.find((r) => /chat/i.test(testoVisibile(r.querySelector('td'))));
      expect(riga, 'nessuna riga per i messaggi della chat: un dato senza tempo di conservazione').toBeTruthy();
      const [, base, conservazione] = Array.from(riga!.querySelectorAll('td')).map((c) => testoVisibile(c));
      expect(base).toMatch(/6\.1\.b/);
      expect(conservazione).toMatch(/cancella il proprio account/);
    } finally {
      s.smonta();
    }
  }, 60000);

  it('e il codice fa quello che la riga promette: i messaggi se ne vanno con l account di chi li ha scritti', () => {
    const voce = TABELLE_CON_DATI_PERSONALI.find((t) => t.tabella === 'messages');
    expect(voce?.colonna).toBe('sender_id');
    expect(voce?.sopravvive, 'la riga del messaggio sopravvive all account: la promessa non è più vera').toBe(false);
    const schema = readFileSync('migrations/026_chat_messaging.sql', 'utf8');
    expect(schema).toMatch(/sender_id uuid NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/);
  });
});
