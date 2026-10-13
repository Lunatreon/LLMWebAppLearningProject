import { useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useMap } from '../map/MapContext';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import { useReflection } from './ReflectionContext';
import { reflectionPrompt } from './types';
export default function ReflectionForm({ hidden }: { hidden: boolean }) {
  const { controller, snapshot, practice } = useReflection(),
    map = useMap(),
    session = useSession();
  const location = useLocation(),
    navigate = useNavigate();
  const input = useRef<HTMLTextAreaElement>(null);
  const { controls, bind } = useDialogControls();
  const completed =
    practice?.status === 'completed' && !snapshot.pending && !snapshot.completedWithNewEdits;
  const pending = snapshot.pending || map.snapshot.pending.includes(`entry:${snapshot.id}`);
  const editable = Boolean(
    practice &&
    snapshot.verified &&
    !snapshot.loading &&
    !completed &&
    !snapshot.initiallyCompleted,
  );
  function close() {
    controller.close();
    navigate({ pathname: '/map', search: location.search }, { replace: true });
  }
  return (
    <DialogFrame
      id="reflection-dialog"
      dialogClass="app-dialog reflection-dialog"
      label="Practice reflection"
      controls={controls}
      focus={input}
      hidden={hidden}
      focusVersion={`${snapshot.id}:${snapshot.verified}:${snapshot.loading}`}
      backdropClose={false}
      onClose={close}
    >
      <form
        id="reflection-form"
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault();
          void controller.submit().then((success) => {
            if (success) close();
          });
        }}
      >
        <button
          ref={bind}
          className="dialog-close"
          type="button"
          aria-label="Close"
          onClick={close}
        >
          ×
        </button>
        <p className="eyebrow">Review without shame</p>
        <h2>What happened when you tried it?</h2>
        <label>
          <span>{reflectionPrompt}</span>
          <textarea
            aria-describedby="reflection-error reflection-load-error"
            id="practice-reflection"
            ref={(node) => {
              input.current = node;
              bind(node);
            }}
            rows={5}
            disabled={!practice || !snapshot.verified || snapshot.loading}
            readOnly={!editable}
            value={completed ? practice?.reflection || '' : snapshot.answer}
            onChange={(event) => controller.edit(event.target.value)}
          />
        </label>
        {snapshot.loading && <p role="status">Loading practice...</p>}
        {snapshot.loadError && (
          <div id="reflection-load-error" className="form-error" role="alert">
            <p>{snapshot.loadError}</p>
            <button
              ref={bind}
              className="secondary-button"
              type="button"
              onClick={() => void controller.open(snapshot.id)}
            >
              Retry practice
            </button>
          </div>
        )}
        {snapshot.error && (
          <p id="reflection-error" className="form-error" role="alert">
            {snapshot.error}
          </p>
        )}
        {completed && <p role="status">This practice is already completed.</p>}
        {snapshot.completedWithNewEdits && practice?.status === 'completed' && (
          <p role="status">Practice completed. Your later changes have not been saved.</p>
        )}
        {map.snapshot.errorStatus === 403 && (
          <p>
            <button
              ref={bind}
              className="secondary-button"
              type="button"
              onClick={() => void session.controller.reload({ force: true })}
            >
              Check session again
            </button>
            {(snapshot.error || snapshot.loadError).includes('verify your email') && (
              <Link
                to={{ pathname: '/activate', search: location.search }}
                state={{
                  email:
                    session.session.status === 'authenticated' ? session.session.account.email : '',
                  afterLogin: '/reflection',
                  practiceId: snapshot.id,
                  reflectionResume: true,
                }}
              >
                Activate account / enter email PIN
              </Link>
            )}
          </p>
        )}
        {completed ? (
          <button ref={bind} className="primary-button" type="button" onClick={close}>
            Return to My Map
          </button>
        ) : (
          <button
            ref={bind}
            className="primary-button"
            type="submit"
            disabled={!editable || pending}
          >
            {pending ? 'Completing...' : 'Mark complete'}
          </button>
        )}
      </form>
    </DialogFrame>
  );
}
