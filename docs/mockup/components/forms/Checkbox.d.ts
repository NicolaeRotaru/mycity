import * as React from 'react';

/** Checkbox with a rich (ReactNode) label — TOS opt-ins, toggles, filters. Terracotta accent. */
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'style' | 'id'> {
  label?: React.ReactNode;
  id?: string;
  error?: string;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}
export function Checkbox(props: CheckboxProps): React.ReactElement;
