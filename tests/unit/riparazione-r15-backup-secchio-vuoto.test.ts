// R15-004 — un secchio che aveva file e dopo la sincronia e vuoto rende rossa la notte,
// anche se un altro secchio si riapre. Dati finti: rclone finto nel PATH, nessuna rete.
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
