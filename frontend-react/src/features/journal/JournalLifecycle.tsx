import { useCallback, useEffect } from 'react';
import { useBeforeUnload } from 'react-router-dom';
import { useDocumentVisibility } from '@react-hookz/web';
import type { JournalController } from './JournalController';

// Stay subscribed across workspace/Terms transitions while feature-owned drafts
// exist. Native event subscription is delegated to documented React hooks.
export default function JournalLifecycle({
  controller,
  enabled,
}: {
  controller: JournalController;
  enabled: boolean;
}) {
  const visible = useDocumentVisibility();
  useEffect(() => {
    if (visible === false && enabled && controller.hasUnsaved()) void controller.flushAll(true);
  }, [visible, controller, enabled]);
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!controller.hasUnsaved()) return;
        if (controller.getSnapshot().enabled) void controller.flushAll(true);
        event.preventDefault();
        event.returnValue = '';
      },
      [controller],
    ),
  );
  return null;
}
