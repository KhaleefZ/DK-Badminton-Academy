import { useEffect, useId, useRef } from 'react';
import { m, useIsPresent } from 'motion/react';
import { X } from 'lucide-react';
import { EASE_OUT, useMotionTransform } from '../lib/motion';

/**
 * DK / Dialog built on the native <dialog> element (focus trap, Esc to close).
 * Render it conditionally inside <AnimatePresence> so the exit animation plays;
 * it opens on mount and calls onClose when dismissed.
 * `animated={false}` opens instantly (used by search, which should never feel delayed).
 */
export default function Dialog({ title, description, onClose, children, footer, as = 'div', onSubmit, animated = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const isPresent = useIsPresent();
  const tf = useMotionTransform();

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.open && dialog.close();
  }, []);

  const Body = as;
  // Modals stay centred (not anchored to a trigger): scale from 0.96, never from 0.
  const motionProps = animated
    ? {
        initial: { opacity: 0, transform: tf('scale(0.96)') },
        animate: { opacity: 1, transform: tf('scale(1)'), transition: { duration: 0.2, ease: EASE_OUT } },
        exit: { opacity: 0, transform: tf('scale(0.97)'), transition: { duration: 0.15, ease: EASE_OUT } },
      }
    : {};

  return (
    <m.dialog
      ref={ref}
      className={`dialog${animated ? ' dialog--animated' : ''}`}
      data-closing={isPresent ? undefined : ''}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      {...motionProps}
    >
      <Body className="dialog__body" onSubmit={onSubmit} noValidate={as === 'form' ? true : undefined}>
        <div className="dialog__header">
          <h2 id={titleId} className="dialog__title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.6} />
          </button>
        </div>
        {description && <p className="dialog__description">{description}</p>}
        <div className="dialog__content">{children}</div>
        {footer && <div className="dialog__footer">{footer}</div>}
      </Body>
    </m.dialog>
  );
}
