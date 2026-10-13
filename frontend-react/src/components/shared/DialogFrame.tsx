import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

// React controls modal rendering/events. Refs are used only for focus, with no
// selector queries, HTML replacement or imperative event binding.
export function useDialogControls() {
  const controls = useRef<HTMLElement[]>([]);
  const bind = (node: HTMLElement | null) => {
    if (node && !controls.current.includes(node)) controls.current.push(node);
  };
  return { controls, bind };
}
export function DialogFrame({
  label,
  children,
  onClose,
  controls,
  focus,
  busy = false,
  inert = false,
  confirm = false,
  hidden = false,
  dialogClass,
  id,
  backdropClose = true,
  focusVersion,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  controls: RefObject<HTMLElement[]>;
  focus?: RefObject<HTMLElement | null>;
  busy?: boolean;
  inert?: boolean;
  confirm?: boolean;
  hidden?: boolean;
  dialogClass?: string;
  id?: string;
  backdropClose?: boolean;
  focusVersion?: string;
}) {
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hidden) return;
    const opener = document.activeElement as HTMLElement | null;
    const preferred = focus?.current;
    (preferred && !('disabled' in preferred && preferred.disabled)
      ? preferred
      : controls.current.find(
          (node) => node.isConnected && !('disabled' in node && node.disabled),
        ) || frame.current
    )?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [controls, focus, hidden, focusVersion]);
  return createPortal(
    <div
      className="map-action-backdrop"
      data-busy={busy}
      onClick={(event) => {
        event.stopPropagation();
        if (backdropClose && event.target === event.currentTarget && !busy) onClose();
      }}
      style={hidden ? { display: 'none' } : undefined}
      inert={inert || hidden}
      aria-hidden={inert || hidden || undefined}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!busy) onClose();
        }
        if (event.key !== 'Tab') return;
        const available = controls.current
          .filter((node) => node.isConnected && !('disabled' in node && node.disabled))
          .sort((a, b) => {
            if (a === b) return 0;
            const follows = a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
            return follows ? -1 : 1;
          });
        const first = available[0],
          last = available.at(-1);
        if (!first || !last) {
          event.preventDefault();
          frame.current?.focus();
          return;
        }
        if (!available.includes(event.target as HTMLElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
          return;
        }
        if (event.shiftKey && event.target === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section
        ref={frame}
        tabIndex={-1}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={dialogClass || (confirm ? 'app-dialog confirm-dialog' : 'map-action-popup')}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
