import * as React from 'react';

/** Bottom-sheet on mobile, centered dialog on desktop. Scroll-lock + Esc + click-outside. */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Footer area, typically action buttons. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
}
export function Modal(props: ModalProps): React.ReactElement | null;
