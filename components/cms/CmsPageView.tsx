import CmsBlockRenderer from './CmsBlockRenderer';
import { cmsEnabledSections, type CmsPage } from '@/lib/cms-page';

/** Vista pubblica di una pagina CMS: titolo + blocchi di contenuto, in un container snello. */
export default function CmsPageView({ page }: { page: CmsPage }) {
  const sections = cmsEnabledSections(page);
  return (
    <div className="bg-surface-50 min-h-[60vh]">
      <div className="container mx-auto px-4 sm:px-6 py-10 md:py-14 max-w-4xl space-y-6">
        {page.title && (
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-ink-900">{page.title}</h1>
        )}
        <CmsBlockRenderer sections={sections} />
      </div>
    </div>
  );
}
