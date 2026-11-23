import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export function Dialog({ title, onClose, busy = false, side = false, children }) {
  const dialog = useRef(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} className={'form-dialog' + (side ? ' side-dialog' : '')} aria-labelledby={heading}
      onSubmit={(event) => event.stopPropagation()}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>, document.body
  );
}
