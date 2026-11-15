// R15-007 — se la trasformazione foto di Supabase si spegne, un interruttore riporta le foto originali.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sizedImage } from '@/lib/image-url'
import caricatoreFotoRemote from '@/lib/image-loader'

const FOTO = 'https://abc.supabase.co/storage/v1/object/public/products/a.jpg'

afterEach(() => vi.unstubAllEnvs())

describe('R15-007 · interruttore della trasformazione foto', () => {
  it('di norma la foto passa dalla trasformazione', () => {
    expect(sizedImage(FOTO, 'card')).toContain('/render/image/public/')
  })

  it('con l interruttore acceso resta l originale, anche dal caricatore', () => {
    vi.stubEnv('NEXT_PUBLIC_FOTO_SENZA_TRASFORMAZIONE', '1')
    expect(sizedImage(FOTO, 'card')).toBe(FOTO)
    const dalCaricatore = caricatoreFotoRemote({ src: FOTO, width: 640 })
    expect(dalCaricatore).not.toContain('/render/image/')
    expect(dalCaricatore).toContain('/storage/v1/object/public/products/a.jpg')
  })
})
