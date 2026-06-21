'use client';

import { Suspense } from 'react';
import SiteEditor from '@/components/seller/site/SiteEditor';
import { LoadingState } from '@/components/ui/LoadingState';

export default function SellerSitePage() {
  return (
    <div className="max-w-6xl">
      <Suspense fallback={<LoadingState />}>
        <SiteEditor />
      </Suspense>
    </div>
  );
}
