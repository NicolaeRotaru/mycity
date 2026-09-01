/** next/image in finto: esce un <img> con l'alt che gli è stato dato. */
import { createElement } from 'react';

function Image(props) {
  const { src, alt, fill, priority, quality, loader, placeholder, blurDataURL, sizes, unoptimized, ...resto } = props;
  void fill; void priority; void quality; void loader; void placeholder; void blurDataURL; void sizes; void unoptimized;
  return createElement('img', { src: typeof src === 'string' ? src : '', alt, ...resto });
}

export default Image;
