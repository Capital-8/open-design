import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type FormEventHandler,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { joinClassNames } from './class-names';
import styles from './dialog.module.css';

type DialogTag = 'div' | 'form';

type DialogLayout = 'default' | 'sectioned';

export interface DialogProps {
  children: ReactNode;
  onClose?: () => void;
  className?: string;
  backdropClassName?: string;
  includeChromeClassName?: boolean;
  id?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  layout?: DialogLayout;
  as?: DialogTag;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  [key: `data-${string}`]: string | number | undefined;
}

type DialogSectionProps = ComponentPropsWithoutRef<'div'>;

type DialogHeadingProps = ComponentPropsWithoutRef<'h2'>;

type DialogDescriptionProps = ComponentPropsWithoutRef<'p'>;

const modalSelector = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const focusableSelector = 'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]';

function isTopDialog(panel: HTMLElement): boolean {
  const modals = [...panel.ownerDocument.querySelectorAll<HTMLElement>(modalSelector)]
    .filter(element => !element.closest('[hidden], [aria-hidden="true"]'));
  return modals.at(-1) === panel;
}

function isFocusableControl(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')
    || element.closest('[hidden], [inert], [aria-hidden="true"]')
    || getComputedStyle(element).visibility === 'hidden') return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).display === 'none') return false;
  }
  return true;
}

export function Dialog({
  children,
  onClose,
  className,
  backdropClassName,
  includeChromeClassName = true,
  id,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  closeOnBackdrop = true,
  closeOnEscape = false,
  layout = 'default',
  as = 'div',
  onSubmit,
  ...dataAttributes
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | HTMLFormElement | null>(null);
  const setPanelRef = useCallback((panel: HTMLDivElement | HTMLFormElement | null) => {
    panelRef.current = panel;
  }, []);
  // A child's autoFocus commits before this layout effect. Retain the opener
  // before that focus change so closing a nested form can return to it.
  const focusBeforeMountRef = useRef<Element | null>(
    typeof document === 'undefined' ? null : document.activeElement,
  );
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const doc = panel.ownerDocument;
    const previous = panel.contains(doc.activeElement)
      ? focusBeforeMountRef.current : doc.activeElement;
    const focusPanel = () => panel.focus({ preventScroll: true });
    if (isTopDialog(panel) && !panel.contains(doc.activeElement)) focusPanel();

    const keepFocusInside = (event: FocusEvent) => {
      if (isTopDialog(panel) && event.target instanceof Node && !panel.contains(event.target)) focusPanel();
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Tab' || !isTopDialog(panel)) return;
      const controls = [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(isFocusableControl);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) {
        event.preventDefault();
        focusPanel();
      } else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) {
        event.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener('focusin', keepFocusInside);
    doc.addEventListener('keydown', trapTab);
    return () => {
      doc.removeEventListener('focusin', keepFocusInside);
      doc.removeEventListener('keydown', trapTab);
      if (previous instanceof HTMLElement && previous.isConnected
        && (panel.contains(doc.activeElement) || doc.activeElement === doc.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    if (!onClose || !closeOnEscape) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape' || !panelRef.current || !isTopDialog(panelRef.current)) return;
      event.preventDefault();
      onClose?.();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, onClose]);

  const sharedProps = {
    ref: setPanelRef,
    tabIndex: -1,
    id,
    className: joinClassNames(
      includeChromeClassName ? styles.dialog : undefined,
      includeChromeClassName && layout === 'sectioned' ? styles.dialogSectioned : undefined,
      includeChromeClassName ? 'modal' : undefined,
      className,
    ),
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    role,
    'aria-modal': 'true' as const,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    ...dataAttributes,
  };

  const overlay = (
    <div
      className={joinClassNames(
        includeChromeClassName ? styles.backdrop : undefined,
        includeChromeClassName ? 'modal-backdrop' : undefined,
        backdropClassName,
      )}
      onClick={closeOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      {as === 'form' ? (
        <form {...sharedProps} onSubmit={onSubmit}>
          {children}
        </form>
      ) : (
        <div {...sharedProps}>{children}</div>
      )}
    </div>
  );

  // Mounted on <body>, not where the dialog is used: the scrim's z-index only
  // outranks app chrome (tabs row 120, the floating account cluster 150) if it
  // competes in the ROOT stacking context. Rendered in place, any ancestor that
  // opens a stacking context traps it — the scrim then stopped at the content
  // area and that chrome floated over the dialog. React events still bubble
  // through the React tree, so callers see no difference.
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
}

export function DialogHeader({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.header, className)} {...props} />;
}

export function DialogBody({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.body, className)} {...props} />;
}

export function DialogFooter({ className, ...props }: DialogSectionProps) {
  return <div className={joinClassNames(styles.footer, className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogHeadingProps) {
  return <h2 className={joinClassNames(styles.title, className)} {...props} />;
}

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <p className={joinClassNames(styles.description, className)} {...props} />;
}
