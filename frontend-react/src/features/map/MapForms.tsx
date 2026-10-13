import { useMap } from './MapContext';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import TopicForm from './TopicForm';
import EntryForm from './EntryForm';

function Confirmation() {
  const { controller, snapshot } = useMap();
  const { controls, bind } = useDialogControls();
  return (
    <DialogFrame
      label="Confirm action"
      controls={controls}
      confirm
      hidden={!snapshot.enabled}
      onClose={() => controller.cancelConfirmation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          controller.acceptConfirmation();
        }}
      >
        <h2>Confirm action</h2>
        <p>{snapshot.confirmation}</p>
        <div className="confirm-dialog-actions">
          <button
            ref={bind}
            className="secondary-button"
            type="button"
            onClick={() => controller.cancelConfirmation()}
          >
            Cancel
          </button>
          <button ref={bind} className="primary-button" type="submit">
            Confirm
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
export default function MapForms() {
  const { snapshot } = useMap();
  return (
    <>
      {snapshot.popup &&
        (snapshot.popup.kind === 'topic' ? (
          <TopicForm key={snapshot.popup.key} popup={snapshot.popup} />
        ) : (
          <EntryForm key={snapshot.popup.key} popup={snapshot.popup} />
        ))}
      {snapshot.confirmation && <Confirmation />}
    </>
  );
}
