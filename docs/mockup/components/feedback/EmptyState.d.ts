import * as React from 'react';

/** Friendly empty / zero-result placeholder — icon medallion, serif title, optional action. */
export interface EmptyStateProps {
  /** Lucide icon name. @default 'package-open' */
  icon?: string;
  title: string;
  description?: string;
  /** Action node, e.g. a Button. */
  action?: React.ReactNode;
  tone?: 'primary' | 'olive' | 'accent' | 'secondary';
  style?: React.CSSProperties;
}
export function EmptyState(props: EmptyStateProps): React.ReactElement;
