'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, ImageOff } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

/**
 * Fotocamera in-app (getUserMedia) con riquadro guida per scattare la foto del
 * prodotto senza passare dal picker di sistema. Pensata mobile-first.
 *
 * Note:
 *  - Richiede contesto sicuro (HTTPS o localhost). Il Permissions-Policy
 *    `camera=(self)` (next.config.js) e la CSP `media-src 'self' blob:`
 *    (middleware.ts) sono necessari perche' lo stream parta.
 *  - iOS Safari: <video muted playsInline> + play() esplicito.
 *  - Lo stream viene SEMPRE fermato (release fotocamera) alla chiusura, allo
 *    smontaggio e prima di ogni ri-acquisizione (cambio fotocamera).
 *  - Fallback: se getUserMedia non e' disponibile o viene negato, si usa
 *    l'input file nativo con capture (stesso pattern di CashConfirmDialog).
 */

type Facing = 'environment' | 'user';

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export default function CameraCapture({ open, onClose, onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (mode: Facing) => {
    setReady(false);
    setError(null);
    stopStream(); // ferma l'eventuale stream precedente prima di ri-acquisire
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('La fotocamera non è disponibile su questo dispositivo o browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* il gesto utente (apertura modale) basta */ }
      }
      setReady(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError') setError('Permesso fotocamera negato.');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('Nessuna fotocamera trovata.');
      else setError('Impossibile avviare la fotocamera.');
    }
  }, [stopStream]);

  // Avvio all'apertura; release a chiusura/smontaggio.
  useEffect(() => {
    if (open) void start(facing);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    stopStream();
    onClose();
  };

  const switchCamera = () => {
    const next: Facing = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void start(next);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    // Ritaglio quadrato centrato sul riquadro guida → inquadratura uniforme.
    const side = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, sx, sy, side, side, 0, 0, side, side);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopStream();
        onCapture(file);
        onClose();
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Scatta foto al prodotto"
      description="Centra il prodotto nel riquadro"
      size="xl"
      closeOnBackdrop={false}
    >
      {error ? (
        <div className="text-center py-6 space-y-4">
          <ImageOff className="mx-auto text-ink-400" size={40} strokeWidth={1.6} aria-hidden />
          <p className="text-sm text-ink-600">{error}</p>
          <button
            type="button"
            onClick={() => fallbackInputRef.current?.click()}
            className="inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-primary-700"
          >
            <Camera size={18} strokeWidth={2.2} aria-hidden /> Usa la fotocamera del telefono
          </button>
          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { onCapture(f); onClose(); }
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {/* Riquadro guida: bordo chiaro + alone scuro intorno */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-[78%] w-[78%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                {/* Griglia (regola dei terzi): aiuta a centrare e raddrizzare il prodotto */}
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
              </div>
            </div>
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Avvio fotocamera…
              </div>
            )}
          </div>
          <p className="text-center text-xs text-ink-500">
            Buona luce, prodotto centrato. Lo sfondo lo puoi pulire dopo con “Sfondo bianco”.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={switchCamera}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50"
            >
              <RefreshCw size={16} strokeWidth={2.2} aria-hidden /> Cambia
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={!ready}
              className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-6 py-3 font-semibold text-white shadow-md hover:bg-primary-700 disabled:opacity-50"
            >
              <Camera size={20} strokeWidth={2.2} aria-hidden /> Scatta
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
