import * as React from 'react';

/**
 * MyCity text input — labelled field with hint/error + optional adornments.
 * 16px text (no iOS zoom), terracotta focus ring, wine error state.
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Node aligned right of the label row (e.g. a "Password dimenticata?" link). */
  labelAction?: React.ReactNode;
  /** Element inside the control on the left (icon). */
  leading?: React.ReactNode;
  /** Element inside the control on the right (e.g. password toggle). */
  trailing?: React.ReactNode;
  containerStyle?: React.CSSProperties;
  style?: React.CSSProperties;
}
export function Input(props: InputProps): React.ReactElement;

export interface FieldProps {
  id: string;
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  labelAction?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Field(props: FieldProps): React.ReactElement;
