import * as React from 'react';

/** Standard surface container — bordered / elevated / flat, with optional hover lift. */
export interface CardProps {
  variant?: 'bordered' | 'elevated' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Add the universal card hover-lift (used on product/store cards). */
  hover?: boolean;
  as?: 'div' | 'article' | 'section' | 'aside';
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Card(props: CardProps): React.ReactElement;
