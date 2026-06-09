'use client';

import { Suspense } from 'react';
import SiteEditor from '@/components/seller/site/SiteEditor';
import { LoadingState } from '@/components/ui/LoadingState';

export default function SellerSitePage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif text-ink-900">Il tuo sito</h1>
        <p className="text-sm text-ink-500">
          Costruisci la tua vetrina come un piccolo sito: scegli un tema e componi le sezioni
          (testo, banner, collezioni di prodotti, galleria, video, FAQ…).
        </p>
      </div>
      <Suspense fallback={<LoadingState />}>
        <SiteEditor />
      </Suspense>
    </div>
  );
}
