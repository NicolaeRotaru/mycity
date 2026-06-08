'use client';

import SectionHeading from './SectionHeading';
import type { SectionConfig, SectionContext } from './SectionContext';

/**
 * Video incorporato. Costruiamo NOI la src da provider + id (mai HTML/iframe arbitrario):
 * YouTube (no-cookie) o Vimeo. Niente embed esterno = niente XSS via iframe.
 */
export default function VideoSection({
  config,
  ctx,
}: {
  config: SectionConfig<'video'>;
  ctx: SectionContext;
}) {
  if (!config.videoId) return null;

  const src =
    config.provider === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${config.videoId}`
      : `https://player.vimeo.com/video/${config.videoId}`;

  return (
    <section>
      {config.heading && <SectionHeading accent={ctx.accent}>{config.heading}</SectionHeading>}
      <div className="relative w-full aspect-video overflow-hidden rounded-2xl border border-cream-300 bg-black">
        <iframe
          src={src}
          title={config.heading || 'Video'}
          className="absolute inset-0 w-full h-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </section>
  );
}
