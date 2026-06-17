import * as React from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'rounded' | 'pill';

/**
 * MyCity button primitive — terracotta primary, mustard accent CTA, wine danger.
 *
 * @startingPoint section="Core" subtitle="Brand buttons — 6 variants, 3 sizes" viewport="700x150"
 */
export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /** Visual style. `accent` (mustard) = high-intent purchase CTA. @default 'primary' */
  variant?: ButtonVariant;
  /** @default 'md' (md/lg meet the 44px touch target) */
  size?: ButtonSize;
  /** @default 'rounded' */
  shape?: ButtonShape;
  /** Show a spinner and disable interaction. @default false */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to container width. @default false */
  fullWidth?: boolean;
  /** Leading icon — a Lucide icon name (string) or a React node. */
  icon?: string | React.ReactNode;
  /** Trailing icon — a Lucide icon name (string) or a React node. */
  iconRight?: string | React.ReactNode;
  /** Render as an anchor instead of a button. */
  href?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): React.ReactElement;
