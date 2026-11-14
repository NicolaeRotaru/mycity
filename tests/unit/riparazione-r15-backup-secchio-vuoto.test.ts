// R15-004 — un secchio che aveva file e dopo la sincronia e vuoto rende rossa la notte,
// anche se un altro secchio si riapre. Dati finti: rclone finto nel PATH, nessuna rete.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mondoFinto } from './riparazione-r15-rclone-finto'

const base = {
  STORAGE_SYNC_SOURCE: 'src:',
  STORAGE_SYNC_DEST: 'b2:mycity-foto',
  STORAGE_SYNC_STORICO: 'b2:mycity-storico',
  STORAGE_SYNC_BUCKETS: 'products stories',
}

describe('R15-004 · controllo di vuoto per singolo secchio', () => {
  it('products svuotato all origine e stories pieno: la notte e rossa', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.cartella('src:products')
    m.file('src:stories', 's.jpg')
    m.file('b2:mycity-foto/products', 'vecchia.jpg')
    m.file('b2:mycity-foto/stories', 's.jpg')
    const r = m.lancia(base)
    expect(r.uscita).toBe(5)
    expect(r.out).toContain('products')
    expect(r.out).not.toContain('copiate e riaperte')
  })

  it('un secchio che era vuoto e resta vuoto (reviews nuovo) non rende rossa la notte', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.cartella('src:products')
    m.file('src:stories', 's.jpg')
    m.file('b2:mycity-foto/stories', 's.jpg')
    const r = m.lancia(base)
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('copiate e riaperte')
  })
})

// R15-004, secondo giro (collaudo K08): la memoria «era pieno» deve durare fra le notti, il rosso
// falso di una cancellazione d'account deve sparire, e un secchio rosso non deve fermare gli altri.
// Il database e' sempre quello finto dell'aiutante (psql finto, DB_URL finto): nessuna rete.
const DB_FINTO = 'postgresql://finto:finto@db-finto.invalid:5432/postgres'
const tre = { ...base, STORAGE_SYNC_BUCKETS: 'products stories reviews' }

describe('R15-004 · secondo giro: il secchio svuotato non torna verde', () => {
  it('stesso mondo due volte, database muto: notte 1 rossa e notte 2 ancora rossa', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.cartella('src:products')
    m.file('src:stories', 's.jpg')
    m.file('b2:mycity-foto/products', 'vecchia.jpg')
    m.file('b2:mycity-foto/stories', 's.jpg')
    m.database()
    const notte1 = m.lancia({ ...base, DB_URL: DB_FINTO })
    expect(notte1.uscita).toBe(5)
    const notte2 = m.lancia({ ...base, DB_URL: DB_FINTO })
    expect(notte2.uscita, notte2.out).toBe(5)
    expect(notte2.out).toContain('il secchio products aveva file nella copia')
    expect(notte2.out).not.toContain('copiate e riaperte')
  })

  it('la memoria e quella dell ultima notte buona: verde, poi origine svuotata, poi due notti rosse', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.file('src:products', 'p.jpg')
    m.file('src:stories', 's.jpg')
    expect(m.lancia(base).uscita).toBe(0)
    rmSync(join(m.radice, 'src', 'products', 'p.jpg'))
    const rossa = m.lancia(base)
    expect(rossa.uscita).toBe(5)
    const rilancio = m.lancia(base)
    expect(rilancio.uscita, rilancio.out).toBe(5)
    expect(rilancio.out).toContain('products')
  })

  it('il database elenca file in un secchio vuoto nella copia: rosso ogni notte, anche la prima', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.cartella('src:products')
    m.file('src:stories', 's.jpg')
    m.database({ products: 4, stories: 1 })
    for (const notte of [1, 2]) {
      const r = m.lancia({ ...base, DB_URL: DB_FINTO })
      expect(r.uscita, `notte ${notte}: ${r.out}`).toBe(5)
      expect(r.out).toContain('il database elenca 4 file nel secchio products')
    }
    // La domanda chiede solo i file nati prima che la copia partisse.
    const registro = readFileSync(join(m.radice, '_db', 'registro'), 'utf8')
    expect(registro).toMatch(/secchio=products/)
    expect(registro).toMatch(/inizio=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/)
    expect(registro).toContain("created_at < :'inizio'")
  })

  it('cancellazione di un account: l ultima foto di reviews tolta e il database d accordo, verde con avviso', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.file('src:products', 'p.jpg')
    m.file('src:stories', 's.jpg')
    m.file('src:reviews', 'utente-1/r.jpg')
    expect(m.lancia(tre).uscita).toBe(0)
    rmSync(join(m.radice, 'src', 'reviews', 'utente-1', 'r.jpg'))
    m.database({ products: 1, stories: 1, reviews: 0 })
    const dopo = m.lancia({ ...tre, DB_URL: DB_FINTO })
    expect(dopo.uscita, dopo.out).toBe(0)
    expect(dopo.out).toContain('::warning::Il secchio reviews non ha piu nessun file, nemmeno nel database')
    expect(dopo.out).not.toContain('esito-foto: fallita')
    expect(dopo.out).not.toMatch(/origine (e' stata svuotata|non si legge)/)
    expect(dopo.out).toContain('copiate e riaperte')
    // La notte dopo e' una notte qualunque, anche col database muto: niente avviso, niente rosso.
    const ancora = m.lancia(tre)
    expect(ancora.uscita, ancora.out).toBe(0)
    expect(ancora.out).not.toContain('::warning::')
    expect(ancora.out).toContain('Il secchio reviews non ha mai avuto file')
  })

  it('products svuotato all origine non ferma la copia di stories', () => {
    const m = mondoFinto()
    m.cartella('b2:mycity-storico')
    m.cartella('src:products')
    m.file('src:stories', 's.jpg')
    m.file('src:stories', 'nuova.jpg')
    m.file('b2:mycity-foto/products', 'vecchia.jpg')
    m.file('b2:mycity-foto/stories', 's.jpg')
    const r = m.lancia(base)
    expect(r.uscita).toBe(5)
    expect(existsSync(join(m.radice, 'b2', 'mycity-foto', 'stories', 'nuova.jpg')), r.out).toBe(true)
    expect(r.out).toContain('secchi da guardare: products')
  })
})
