// Con una destinazione che ha una cartella dentro il secchio ("b2:mycity-foto/copie") lo storico
// predefinito non deve finire nello stesso secchio della copia. Blocco delle foto di
// scripts/backup-db.sh con rclone finto nel PATH (aiutante R15, solo letto): nessuna rete.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mondoFinto } from './riparazione-r15-rclone-finto'

function elenco(d: string): string[] {
  if (!existsSync(d)) return []
  return (readdirSync(d, { recursive: true, withFileTypes: true }) as Array<{ isFile(): boolean; name: string; parentPath?: string; path?: string }>)
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path ?? d, e.name).slice(d.length + 1))
    .sort()
}

describe('R09 · lo storico predefinito sta in un secchio diverso dalla copia', () => {
  it('destinazione "b2:mycity-foto/copie": lo storico va in "b2:mycity-foto-storico/copie", non dentro mycity-foto', () => {
    const m = mondoFinto()
    m.file('src:products', 'a.jpg')
    m.file('b2:mycity-foto/copie/products', 'a.jpg')
    m.file('b2:mycity-foto/copie/products', 'cancellata.jpg')
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:mycity-foto/copie', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.out).toContain('b2:mycity-foto-storico/copie')
    expect(elenco(join(m.radice, 'b2', 'mycity-foto-storico'))).toEqual(['copie/T1/products/cancellata.jpg'])
    expect(elenco(join(m.radice, 'b2', 'mycity-foto')).filter((f) => !f.startsWith('copie/products/') && !f.startsWith('copie/_memoria-copia/'))).toEqual([])
  })

  it('remote usato alla radice ("cifrata:"): nessun secchio da cui ricavare lo storico, notte rossa', () => {
    const m = mondoFinto()
    m.file('src:products', 'a.jpg')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'cifrata:', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).not.toBe(0)
    expect(r.out).toContain('esito-foto: fallita')
    expect(r.out).not.toContain('copiate e riaperte')
  })

  it('percorso assoluto senza secchi ("nas:/mnt/x"): come prima, "nas:/mnt/x-storico", con la barra iniziale', () => {
    const m = mondoFinto()
    m.file('src:products', 'a.jpg')
    m.file('nas:mnt/x/products', 'a.jpg')
    m.file('nas:mnt/x/products', 'cancellata.jpg')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'nas:/mnt/x', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in nas:/mnt/x-storico;')
    expect(r.out).not.toContain('nas:mnt-storico')
    expect(elenco(join(m.radice, 'nas', 'mnt', 'x-storico'))).toEqual(['T1/products/cancellata.jpg'])
    expect(existsSync(join(m.radice, 'nas', 'mnt-storico'))).toBe(false)
  })

  it('destinazione semplice "b2:mycity-foto": come prima, "b2:mycity-foto-storico"', () => {
    const m = mondoFinto()
    m.file('src:products', 'a.jpg')
    m.cartella('b2:mycity-foto-storico')
    const r = m.lancia({ STORAGE_SYNC_SOURCE: 'src:', STORAGE_SYNC_DEST: 'b2:mycity-foto', STORAGE_SYNC_BUCKETS: 'products' })
    expect(r.uscita).toBe(0)
    expect(r.out).toContain('storico in b2:mycity-foto-storico;')
  })
})
