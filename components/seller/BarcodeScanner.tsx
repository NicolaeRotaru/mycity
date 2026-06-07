'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

/**
 * Scanner EAN/codice a barre in-app. Usa la BarcodeDetector API nativa
 * (Chromium/Android/Brave) sul flusso getUserMedia; se non disponibile o se il
 * permesso è negato, ripiega sull'inserimento manuale. Al rilevamento compila
 * il campo EAN del prodotto.
 */

interface DetectedBarcode { rawValue: string; format: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

export default function BarcodeScanner({ open, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [manual, setManual] = useState('');

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (code: string) => {
      stop();
      onDetected(code);
      onClose();
    },
    [stop, onDetected, onClose],
  );

  const start = useCallback(async () => {
    setError(null);
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      return;
    }
    try {
      detectorRef.current = new Ctor({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* gesto utente già presente */ }
      }
      const tick = async () => {
        const video = videoRef.current;
        const det = detectorRef.current;
        if (!video || !det || !streamRef.current) return;
        try {
          if (video.readyState >= 2) {
            const codes = await det.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit) { finish(hit.rawValue.replace(/\s/g, '')); return; }
          }
        } catch { /* frame non leggibile: continua */ }
        rafRef.current = requestAnimationFrame(() => { void tick(); });
      };
      rafRef.current = requestAnimationFrame(() => { void tick(); });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Permesso fotocamera negato.' : 'Impossibile avviare la fotocamera.');
    }
  }, [finish]);

  useEffect(() => {
    if (open) {
      setUnsupported(false);
      setError(null);
      setManual('');
      void start();
    }
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { stop(); onClose(); };
  const submitManual = () => { const v = manual.trim(); if (v) finish(v); };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Scansiona il codice a barre"
      description="Inquadra l'EAN sul retro della confezione"
      size="lg"
      closeOnBackdrop={false}
    >
      {unsupported || error ? (
        <div className="space-y-3 py-2 text-center">
          <ScanLine className="mx-auto text-ink-400" size={36} strokeWidth={1.6} aria-hidden />
          <p className="text-sm text-ink-600">
            {error ?? 'La scansione automatica non è supportata su questo browser. Inserisci il codice a mano.'}
          </p>
          <ManualEntry value={manual} onChange={setManual} onSubmit={submitManual} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-20 w-[82%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          </div>
          <p className="text-center text-xs text-ink-500">Tieni il codice a fuoco e ben illuminato.</p>
          <ManualEntry value={manual} onChange={setManual} onSubmit={submitManual} />
        </div>
      )}
    </Modal>
  );
}

function ManualEntry({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        inputMode="numeric"
        placeholder="Inserisci EAN a mano"
        className="flex-1 rounded-lg border border-cream-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
      />
      <button
        type="button"
        onClick={onSubmit}
        className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
      >
        OK
      </button>
    </div>
  );
}
