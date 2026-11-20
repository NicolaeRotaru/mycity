// R02-005 — Se il secchio dello storico delle foto non si crea, lo storico finiva nello stesso secchio
// della copia ("<destinazione>/_storico") e la notte restava verde.
//
// Scelta di Nicola: senza il secchio dello storico la notte è ROSSA (uscita diversa da 0), e lo storico
// non finisce MAI nel secchio della copia. Qui il blocco delle foto di scripts/backup-db.sh, fatto girare
// con bash e un rclone finto nel PATH (l'aiutante delle prove R15, solo letto): nessuna rete, nessun
// secchio vero. Il caso normale resta verde.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mondoFinto } from './riparazione-r15-rclone-finto'

/** Tutti i file sotto una cartella del mondo finto ("remote:percorso"), col percorso relativo. */
function fileIn(radice: string, remoto: string): string[] {
  const [r, p] = remoto.split(':')
  const d = join(radice, r, p)
  if (!existsSync(d)) return []
  return (readdirSync(d, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath?: string; path?: string }>)
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path ?? d, e.name).slice(d.length + 1))
    .sort()
}

/** Una copia con una foto che c'è ancora e una sparita dall'origine (il caso in cui serve lo storico). */
function copiaConUnaFotoSparita() {
  const m = mondoFinto()
  m.file('src:products', 'a.jpg')
  m.file('b2:mycity-foto/products', 'a.jpg')
  m.file('b2:mycity-foto/products', 'cancellata.jpg')
  return m
}

describe('R02-005 · senza il secchio dello storico la notte è rossa, e lo storico non entra nella copia', () => {
  for (const dest of ['b2:mycity-foto', 'b2:mycity-foto/']) {
    it(`il secchio «-storico» non c'è e non si crea (destinazione "${dest}"): uscita rossa, niente dentro la copia`, () => {
      const m = copiaConUnaFotoSparita()
      const r = m.lancia({
        STORAGE_SYNC_SOURCE: 'src:',
        STORAGE_SYNC_DEST: dest,
        STORAGE_SYNC_BUCKETS: 'products',
        FAKE_MKDIR_FAIL: '1',
      })
      expect(r.uscita, `la notte resta verde senza storico:\n${r.out}`).not.toBe(0)
      expect(r.out).toContain('esito-foto: fallita')
      expect(r.out).toContain('b2:mycity-foto-storico')
      expect(r.out).not.toContain('copiate e riaperte')
      // Nel secchio della copia: solo i secchi copiati, nessuno storico accanto a loro.
      expect(fileIn(m.radice, 'b2:mycity-foto'), 'lo storico è finito nello stesso secchio della copia').toEqual([
        'products/a.jpg',
        'products/cancellata.jpg',
      ])
      expect(existsSync(join(m.radice, 'b2', 'mycity-foto', '_storico'))).toBe(false)
    })
  }

  it('anche uno STORAGE_SYNC_STORICO scritto a mano che non esiste e non si crea fa rossa la notte', () => {
    const m = copiaConUnaFotoSparita()
    const r = m.lancia({
      STORAGE_SYNC_SOURCE: 'src:',
      STORAGE_SYNC_DEST: 'b2:mycity-foto',
      STORAGE_SYNC_STORICO: 'b2:mio-storico',
      STORAGE_SYNC_BUCKETS: 'products',
      FAKE_MKDIR_FAIL: '1',
    })
    expect(r.uscita).not.toBe(0)
    expect(r.out).toContain('b2:mio-storico')
    expect(fileIn(m.radice, 'b2:mycity-foto')).toEqual(['products/a.jpg', 'products/cancellata.jpg'])
  })
})

describe('R02-005 · col secchio dello storico tutto come prima', () => {
  it('il secchio «-storico» esiste: verde, e la foto sparita va nello storico, fuori dal secchio della copia', () => {
    const m = copiaConUnaFotoSparita()
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:mycity-foto', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita, r.out).toBe(0)
    expect(r.out).toContain('copiate e riaperte')
    // Nel secchio della copia restano la foto viva e la memoria fra le notti, niente storico.
    expect(fileIn(m.radice, 'b2:mycity-foto')).toEqual(['_memoria-copia/products.aveva-file', 'products/a.jpg'])
    expect(fileIn(m.radice, 'b2:mycity-foto-storico')).toEqual(['T1/products/cancellata.jpg'])
  })

  it('il secchio «-storico» non c era ma si crea: verde', () => {
    const m = copiaConUnaFotoSparita()
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:mycity-foto', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita, r.out).toBe(0)
    expect(r.out).toContain('Storico delle foto pronto: b2:mycity-foto-storico')
    expect(fileIn(m.radice, 'b2:mycity-foto-storico')).toEqual(['T1/products/cancellata.jpg'])
  })
})
