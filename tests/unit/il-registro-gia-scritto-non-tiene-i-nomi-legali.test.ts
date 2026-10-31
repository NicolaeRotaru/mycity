/**
 * LE RIGHE DEL REGISTRO SCRITTE PRIMA DELLA 155 TENEVANO I NOMI LEGALI IN CHIARO.
 *
 * La 155 ha chiuso il trigger `log_activity_change` per il futuro (la prova
 * il-registro-attivita-non-copia-il-cognome-legale.test.ts lo tiene fermo), ma
 * dice di se' «non tocca nessuna riga gia' scritta». Le righe nate prima — con
 * `legal_first_name: Mario`, `legal_last_name: Rossi`, il biglietto privato di
 * un buono regalo — restavano in `activity_events.metadata.changed` fino alla
 * potatura dei 14 mesi.
 *
 * Questa prova accende un PostgreSQL vero, ci mette la regola che comanda oggi
 * (l'ultima migrazione che definisce `activity_key_sensibile`), scrive righe
 * come le scriveva il trigger vecchio, applica la migrazione 183 e chiede al
 * database: un nome legale c'e' ancora? Senza la 183 la risposta e' si', e la
 * prova e' rossa.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

const MIGRAZIONI = join(process.cwd(), 'migrations');
const PULIZIA = join(MIGRAZIONI, '183_il_registro_non_copia_i_nomi_legali.sql');

function regolaCheComanda(): string {
  const file = readdirSync(MIGRAZIONI)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => readFileSync(join(MIGRAZIONI, f), 'utf8')
      .includes('CREATE OR REPLACE FUNCTION public.activity_key_sensibile'))
    .sort()
    .pop();
  if (!file) throw new Error('nessuna migrazione definisce activity_key_sensibile');
  return readFileSync(join(MIGRAZIONI, file), 'utf8');
}

/** Come scriveva il trigger prima della 155: i valori veri, in chiaro. */
const RIGHE_VECCHIE = `
INSERT INTO public.activity_events (id, event_type, metadata) VALUES
 (1, 'profiles.update', '{"changed": {"legal_first_name": {"old": null, "new": "Mario"}, "legal_last_name": {"old": null, "new": "Rossi"}, "approval_status": {"old": "pending", "new": "approved"}}}'),
 (2, 'gift_cards.update', '{"changed": {"recipient_name": {"old": "Anna", "new": "Anna Bianchi"}, "message": {"old": "", "new": "Buon compleanno nonna"}, "status": {"old": "active", "new": "redeemed"}}}'),
 (3, 'profiles.update', '{"changed": {"rider_haccp_url": {"old": null, "new": "u3/attestato-1700000000000.pdf"}, "rider_insurance_url": {"old": null, "new": "u3/polizza-1700000000000.pdf"}}}'),
 (4, 'profiles.update', '{"changed": {"legal_last_name": {"old": "***", "new": "***"}}}'),
 (5, 'orders.insert', NULL),
 (6, 'orders.delete', '{"deleted_row_id": "abc"}');
`;

describe.skipIf(!BIN_POSTGRES)('le righe gia\' scritte nel registro (database vero)', () => {
  let pg: Postgres;

  beforeAll(() => {
    pg = avviaPostgres();
    pg.psql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.activity_events (
        id bigint PRIMARY KEY, event_type text, metadata jsonb, summary text,
        created_at timestamptz DEFAULT now());
    `);
    pg.psql(regolaCheComanda());
    pg.psql(RIGHE_VECCHIE);
    if (existsSync(PULIZIA)) pg.psql(readFileSync(PULIZIA, 'utf8'));
  }, 60_000);

  afterAll(() => pg?.ferma());

  it('nessun nome legale, biglietto privato o documento resta in chiaro', () => {
    const rimasti = pg.psql(`
      SELECT id FROM public.activity_events
       WHERE metadata::text ~ '(Mario|Rossi|Anna|compleanno|attestato|polizza)' ORDER BY id;`);
    expect(rimasti).toBe('');
  });

  it('i nomi diventano *** come li scrive il trigger, gli stati restano leggibili', () => {
    expect(pg.psql(`SELECT metadata->'changed'->'legal_first_name' FROM public.activity_events WHERE id = 1;`))
      .toBe('{"new": "***", "old": "***"}');
    expect(pg.psql(`SELECT metadata->'changed'->'approval_status'->>'new' FROM public.activity_events WHERE id = 1;`))
      .toBe('approved');
    expect(pg.psql(`SELECT metadata->'changed'->'status'->>'new' FROM public.activity_events WHERE id = 2;`))
      .toBe('redeemed');
  });

  it('le righe senza diff non si toccano, e rigirata non cambia niente', () => {
    expect(pg.psql(`SELECT coalesce(metadata::text, 'NULL') FROM public.activity_events WHERE id IN (5, 6) ORDER BY id;`))
      .toBe('NULL\n{"deleted_row_id": "abc"}');
    const prima = pg.psql(`SELECT md5(string_agg(metadata::text, '|' ORDER BY id)) FROM public.activity_events;`);
    pg.psql(readFileSync(PULIZIA, 'utf8'));
    expect(pg.psql(`SELECT md5(string_agg(metadata::text, '|' ORDER BY id)) FROM public.activity_events;`)).toBe(prima);
  });
});
