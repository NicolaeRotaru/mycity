// R15-003 — lo storico delle foto non deve dipendere da un secchio «-storico» che nessuno ha creato.
// Dati finti: rclone finto nel PATH, nessuna rete, nessun secchio vero.
import { describe, expect, it } from 'vitest'
import { mondoFinto } from './riparazione-r15-rclone-finto'

describe('R15-003 · storico delle foto senza secchio dedicato', () => {
  for (const dest of ['b2:mycity-foto', 'b2:mycity-foto/']) {
    it(`una foto sparita dall'origine non fa rossa la copia (destinazione "${dest}")`, () => {
      const m = mondoFinto()
      m.file('src:products', 'a.jpg')
      m.file('b2:mycity-foto/products', 'a.jpg')
      m.file('b2:mycity-foto/products', 'cancellata.jpg')
      const r = m.lancia({
        STORAGE_SYNC_SOURCE: 'src:',
        STORAGE_SYNC_DEST: dest,
        STORAGE_SYNC_BUCKETS: 'products',
        FAKE_MKDIR_FAIL: '1',
      })
      expect(r.out).toContain('copiate e riaperte')
      expect(r.uscita).toBe(0)
    })
  }

  it('se STORAGE_SYNC_STORICO e impostato resta quello', () => {
    const m = mondoFinto()
    m.file('src:products', 'a.jpg')
    m.file('b2:mycity-foto/products', 'a.jpg')
    m.cartella('b2:mio-storico')
    const r = m.lancia({
      STORAGE_SYNC_SOURCE: 'src:',
      STORAGE_SYNC_DEST: 'b2:mycity-foto',
      STORAGE_SYNC_STORICO: 'b2:mio-storico',
      STORAGE_SYNC_BUCKETS: 'products',
    })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in b2:mio-storico')
  })
})
