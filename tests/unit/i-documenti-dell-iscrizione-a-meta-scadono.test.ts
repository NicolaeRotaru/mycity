/**
 * I DOCUMENTI DI CHI SI FERMA A META' ISCRIZIONE NON SCADEVANO MAI.
 *
 * `approval_status` nasce 'pending' e l'unica potatura sui documenti guardava
 * i respinti. Chi caricava carta d'identita' e selfie e poi abbandonava restava
 * 'pending' per sempre, coi file nel secchio `kyc-docs`. Scelta di Nicola del
 * 31/10/2026: trenta giorni, poi si cancellano; se torna, li ricarica.
 *
 * Due meta', due prove:
 *  ① IL DATABASE (PostgreSQL vero, migrazione 171 eseguita): chi decide chi e'
 *     «a meta'». 29 giorni resta · 31 si cancella · approvato resta · respinto
 *     resta alla regola di prima · chi ha inviato e aspetta resta · chi sta
 *     ancora caricando resta.
 *  ② LA NOTTE (lib/privacy/potature-ritenzione.ts): la potatura cancella dalla
 *     vista con 30 giorni, prende la coda e toglie i file dal secchio, e il
 *     conto senza cancellare li CONTA invece di dire «non contata».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  potatureDiRitenzione,
  contaPotature,
  eseguiPotature,
  type ClientePotature,
  type ClienteCheConta,
  type Registro,
} from '@/lib/privacy/potature-ritenzione';
import { BIN_POSTGRES, avviaPostgres, type Postgres } from './postgres-usa-e-getta';

const GIORNI = 30; // registro dei fatti, kyc.documenti-iscrizione-a-meta
const MIGRAZIONE = join(process.cwd(), 'migrations', '171_i_documenti_d_identita_scadono.sql');
const GIORNO_MS = 86_400_000;
const nomeFile = (utente: string, tipo: string, giorniFa: number) =>
  `${utente}/${tipo}-${Date.now() - giorniFa * GIORNO_MS}.jpg`;

describe.skipIf(!BIN_POSTGRES)("chi e' «a meta' iscrizione» lo decide il database (migrazione 171 eseguita)", () => {
  let pg: Postgres;
  const u = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
  const f = {
    a29: nomeFile(u(1), 'kyc_selfie', 29),
    b31fronte: nomeFile(u(2), 'kyc_id_front', 31),
    b31selfie: nomeFile(u(2), 'kyc_selfie', 40),
    c31: nomeFile(u(3), 'kyc_selfie', 31),
    d31: nomeFile(u(4), 'kyc_selfie', 31),
    e31: nomeFile(u(5), 'kyc_selfie', 31),
    g31: nomeFile(u(6), 'rider_license', 31),
    h40: nomeFile(u(7), 'kyc_id_front', 40),
    h2: nomeFile(u(7), 'kyc_id_back', 2),
    senzaFile31: nomeFile(u(8), 'kyc_selfie', 31),
  };

  beforeAll(() => {
    pg = avviaPostgres();
    pg.psql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (bucket_id text, name text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY, approval_status text DEFAULT 'pending',
        approval_requested_at timestamptz, approved_at timestamptz, kyc_provider_checked_at timestamptz,
        kyc_id_doc_front_url text, kyc_id_doc_back_url text, kyc_selfie_url text,
        rider_license_url text, rider_insurance_url text, rider_haccp_url text);
      INSERT INTO public.profiles (id, approval_status, approval_requested_at, approved_at, kyc_provider_checked_at,
                                   kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url, rider_license_url) VALUES
        ('${u(1)}', 'pending',  NULL, NULL, NULL, NULL, NULL, '${f.a29}', NULL),
        ('${u(2)}', 'pending',  NULL, NULL, NULL, '${f.b31fronte}', NULL, '${f.b31selfie}', NULL),
        ('${u(3)}', 'approved', now() - interval '45 days', now() - interval '31 days', NULL, NULL, NULL, '${f.c31}', NULL),
        ('${u(4)}', 'rejected', now() - interval '45 days', now() - interval '31 days', NULL, NULL, NULL, '${f.d31}', NULL),
        ('${u(5)}', 'pending',  now() - interval '31 days', NULL, NULL, NULL, NULL, '${f.e31}', NULL),
        ('${u(6)}', 'pending',  NULL, NULL, now() - interval '31 days', NULL, NULL, NULL, '${f.g31}'),
        ('${u(7)}', 'pending',  NULL, NULL, NULL, '${f.h40}', '${f.h2}', NULL, NULL),
        ('${u(8)}', 'pending',  NULL, NULL, NULL, NULL, NULL, '${f.senzaFile31}', NULL),
        ('${u(9)}', 'pending',  NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
        ('kyc-docs', '${f.a29}', now() - interval '29 days'),
        ('kyc-docs', '${f.b31fronte}', now() - interval '31 days'),
        ('kyc-docs', '${f.b31selfie}', now() - interval '40 days'),
        ('kyc-docs', '${f.c31}', now() - interval '31 days'),
        ('kyc-docs', '${f.d31}', now() - interval '31 days'),
        ('kyc-docs', '${f.e31}', now() - interval '31 days'),
        ('kyc-docs', '${f.g31}', now() - interval '31 days'),
        ('kyc-docs', '${f.h40}', now() - interval '40 days'),
        ('kyc-docs', '${f.h2}', now() - interval '2 days');
    `);
    if (existsSync(MIGRAZIONE)) pg.psql(readFileSync(MIGRAZIONE, 'utf8'));
  }, 60_000);

  afterAll(() => pg?.ferma());

  const docRimasti = () => pg.psql(`
    SELECT right(id::text, 1) || '=' || cardinality(array_remove(ARRAY[kyc_id_doc_front_url, kyc_id_doc_back_url,
           kyc_selfie_url, rider_license_url, rider_insurance_url, rider_haccp_url], NULL))
      FROM public.profiles ORDER BY id;`).split('\n').join(' ');

  it('il conto senza cancellare vede le due iscrizioni abbandonate da piu\' di 30 giorni', () => {
    expect(pg.psql(`SELECT count(*) FROM public.documenti_iscrizione_a_meta WHERE caricati_at < now() - interval '${GIORNI} days';`)).toBe('2');
    expect(docRimasti()).toBe('1=1 2=2 3=1 4=1 5=1 6=1 7=2 8=1 9=0');
  });

  it('31 giorni si cancella; 29, approvato, respinto, inviato, ancora in corso restano', () => {
    expect(pg.psql(`
      WITH tolte AS (DELETE FROM public.documenti_iscrizione_a_meta
                      WHERE caricati_at < now() - interval '${GIORNI} days' RETURNING 1)
      SELECT count(*) FROM tolte;`)).toBe('2');
    expect(docRimasti()).toBe('1=1 2=0 3=1 4=1 5=1 6=1 7=2 8=0 9=0');
    const presi = pg.psql(`
      SELECT right(user_id::text, 1) || ':' || array_to_string(percorsi, ',')
        FROM public.kyc_file_da_togliere_prendi() ORDER BY user_id;`);
    expect(presi).toBe(`2:${f.b31fronte},${f.b31selfie}\n8:${f.senzaFile31}`);
  });

  it('rigirata non trova niente, la coda presa e\' vuota, e nessuno da fuori ci arriva', () => {
    expect(pg.psql(`
      WITH tolte AS (DELETE FROM public.documenti_iscrizione_a_meta
                      WHERE caricati_at < now() - interval '${GIORNI} days' RETURNING 1)
      SELECT count(*) FROM tolte;`)).toBe('0');
    expect(pg.psql(`SELECT count(*) FROM public.kyc_file_da_togliere_prendi();`)).toBe('0');
    expect(pg.psql(`
      SELECT bool_or(has_function_privilege(r, 'public.kyc_file_da_togliere_prendi()', 'EXECUTE')
                     OR has_table_privilege(r, 'public.documenti_iscrizione_a_meta', 'SELECT')
                     OR has_table_privilege(r, 'public.documenti_iscrizione_a_meta', 'DELETE')
                     OR has_table_privilege(r, 'public.kyc_file_da_togliere', 'SELECT'))
        FROM unnest(ARRAY['anon', 'authenticated']) r;`)).toBe('f');
  });
});

describe('la notte toglie i documenti dell\'iscrizione a meta\'', () => {
  const muto: Registro = { info: () => {}, warn: () => {}, error: () => {} };
  const adesso = Date.parse('2026-10-31T03:00:00Z');
  const limite = new Date(adesso - GIORNI * GIORNO_MS).toISOString();

  it('cancella dalla vista con 30 giorni, poi prende la coda e toglie i file da kyc-docs', async () => {
    const diario: string[] = [];
    const filtro = (op: string, tabella: string) => {
      const filtri: string[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ['eq', 'lt', 'is', 'not', 'or']) {
        q[m] = (...a: unknown[]) => { filtri.push(`${m}:${a.join(',')}`); return q; };
      }
      q.then = (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => {
        diario.push(`${op} ${tabella} ${filtri.join(' ')}`);
        return Promise.resolve({ error: null }).then(ok, ko);
      };
      return q;
    };
    const admin = {
      from: (t: string) => ({ update: () => filtro('update', t), delete: () => filtro('delete', t) }),
      rpc: async (nome: string, argomenti?: Record<string, unknown>) => {
        diario.push(`rpc ${nome} ${JSON.stringify(argomenti ?? null)}`);
        return nome === 'kyc_file_da_togliere_prendi'
          ? { data: [{ user_id: 'u2', percorsi: ['u2/kyc_selfie-1.jpg', 'u2/kyc_id_front-1.jpg'] }], error: null }
          : { data: [], error: null };
      },
      storage: {
        from: (secchio: string) => ({
          remove: async (percorsi: string[]) => { diario.push(`remove ${secchio} ${percorsi.join(',')}`); return { error: null }; },
        }),
      },
    } as unknown as ClientePotature;

    const passi = potatureDiRitenzione(adesso).filter((p) => p.cosa === 'documenti-kyc-iscrizione-a-meta');
    expect(passi).toHaveLength(1);
    const rapporto = await eseguiPotature(admin, muto, adesso, passi);

    expect(rapporto.fallite).toBe(0);
    expect(diario).toEqual([
      `delete documenti_iscrizione_a_meta lt:caricati_at,${limite}`,
      'rpc kyc_file_da_togliere_prendi {}',
      'remove kyc-docs u2/kyc_selfie-1.jpg,u2/kyc_id_front-1.jpg',
    ]);
  });

  it('il conto senza cancellare li conta, con la stessa vista e lo stesso filtro, senza cancellare niente', async () => {
    const letture: string[] = [];
    let rpcChiamate = 0;
    const admin = {
      from: (tabella: string) => ({
        select: () => {
          const filtri: string[] = [];
          const q: Record<string, unknown> = {};
          for (const m of ['eq', 'is', 'not', 'or']) q[m] = () => q;
          q.lt = (colonna: string, valore: string) => { filtri.push(`${colonna}<${valore}`); return q; };
          q.then = (ok: (r: unknown) => unknown, ko: (e: unknown) => unknown) => {
            letture.push(`${tabella} ${filtri.join(' ')}`);
            return Promise.resolve({ count: tabella === 'documenti_iscrizione_a_meta' ? 7 : 0, error: null }).then(ok, ko);
          };
          return q;
        },
      }),
      rpc: async () => { rpcChiamate += 1; return { data: null, error: { message: 'nel conto non si chiama' } }; },
    } as unknown as ClienteCheConta;

    const conti = await contaPotature(admin, adesso);

    expect(conti.find((c) => c.cosa === 'documenti-kyc-iscrizione-a-meta')).toEqual({
      cosa: 'documenti-kyc-iscrizione-a-meta', righe: 7,
    });
    expect(letture).toContain(`documenti_iscrizione_a_meta caricati_at<${limite}`);
    expect(rpcChiamate, 'il conto non chiama funzioni del database').toBe(0);
  });
});
