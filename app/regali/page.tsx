import type { Metadata } from 'next';
import RegaliClient from './RegaliClient';

export const metadata: Metadata = {
  title: 'Idee regalo · MyCity',
  description: 'Una selezione di idee regalo dai negozi di Piacenza. Paghi alla consegna.',
};

export default function RegaliPage() {
  return <RegaliClient />;
}
