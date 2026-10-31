import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { statoFinaleDeiPermessi } from './aiuti/permessi-dalle-migrazioni';

/**
 * 31/10/2026 (ondata 1, correzione dopo il collaudo) — LA VISTA DEI NOMI LA LEGGE SOLO CHI HA L'ACCOUNT.
 *
 * La migrazione 164 apre `nomi_pubblici (id, nome)`: il nome di battesimo di chi ha scritto una
 * recensione o una domanda, e del fattorino per il cliente e il negozio del suo ordine. Gira coi
 * permessi di chi l'ha creata, quindi scavalca le regole di `profiles` — apposta, perche' dopo la 161
 * quella tabella si legge solo per la propria riga.
 *
 * Il collaudo l'ha bocciata perche' la concedeva anche ad `anon`: chiunque, senza account, con una
 * sola richiesta a /rest/v1/nomi_pubblici scaricava l'elenco di tutti quelli che hanno scritto una
 * recensione o una domanda, con identificativo e nome. Esempio: Beppe scrive «Ottimo pane» sotto
 * Pane Quotidiano; un anonimo legge «u-beppe → Beppe» senza aprire la vetrina.
 *
 * La prova non cerca parole nella migrazione: rilegge TUTTE le migrazioni in ordine con lo stesso
 * lettore del guardiano (tests/unit/nessuna-funzione-potente-in-mano-a-chi-non-ha-l-account.test.ts)
 * e guarda lo stato finale dei permessi, compresi i privilegi di default di Supabase che danno
 * SELECT ad `anon` su ogni vista nuova.
 */
const stato = statoFinaleDeiPermessi(path.resolve(process.cwd(), 'migrations'));
const vista = stato.viste.get('nomi_pubblici');

describe('la vista nomi_pubblici (migrazione 164)', () => {
  it('esiste: senza, dopo la 161 ogni recensione e domanda torna firmata «Cliente»', () => {
    expect(vista, 'la vista nomi_pubblici non nasce da nessuna migrazione').toBeTruthy();
  });

  it('chi non ha l account non la legge: niente elenco di persone e nomi a un anonimo', () => {
    expect(vista?.anonPuoLeggere, `nomi_pubblici e' leggibile senza account (${vista?.ultimoFile})`).toBe(false);
  });

  it('chi ha l account la legge: e il punto della vista, il fattorino e gli autori col loro nome', () => {
    expect(vista?.autenticatoPuoLeggere).toBe(true);
  });

  it('non mostra il cognome ne altre colonne: solo id e la prima parola del nome', () => {
    const corpo = (vista?.corpo ?? '').replace(/\s+/g, ' ');
    expect(corpo).toMatch(/select p\.id, nullif\(split_part\(btrim\(p\.full_name\), ' ', 1\), ''\) as nome from/i);
  });
});
