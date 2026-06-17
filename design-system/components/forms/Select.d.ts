import * as React from 'react';

/** Native select in the shared Field shell with a chevron adornment. */
export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): React.ReactElement;
