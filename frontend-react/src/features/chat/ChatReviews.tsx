import { useChat } from './ChatContext';
import { DialogFrame, useDialogControls } from '../../components/shared/DialogFrame';
import TopicReview from './TopicReview';
import NoteReview from './NoteReview';

function DeleteConfirmation({ hidden }: { hidden: boolean }) {
  const { controller, snapshot } = useChat(),
    { controls, bind } = useDialogControls();
  const id = snapshot.confirmation!,
    chat = snapshot.chats.find((chat) => chat.chat_id === id);
  return (
    <DialogFrame
      label="Confirm action"
      confirm
      controls={controls}
      hidden={hidden}
      onClose={() => controller.closeConfirmation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void controller.remove(id);
        }}
      >
        <h2>Confirm action</h2>
        <p>Delete "{chat?.title || 'New conversation'}"? This cannot be undone.</p>
        <div className="confirm-dialog-actions">
          <button
            ref={bind}
            className="secondary-button"
            type="button"
            onClick={() => controller.closeConfirmation()}
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
export default function ChatReviews({ hidden }: { hidden: boolean }) {
  const { snapshot } = useChat();
  const chat = snapshot.chats.find((chat) => chat.chat_id === snapshot.active);
  return (
    <>
      {snapshot.review === 'topic' && chat?.pending_topic && (
        <TopicReview
          key={`${snapshot.active}:${JSON.stringify(chat.pending_topic)}`}
          suggestion={chat.pending_topic}
          hidden={hidden}
        />
      )}
      {snapshot.review === 'note' && snapshot.mapAccess && chat?.pending_map_suggestion && (
        <NoteReview
          key={`${snapshot.active}:${JSON.stringify(chat.pending_map_suggestion)}`}
          suggestion={chat.pending_map_suggestion}
          hidden={hidden}
        />
      )}
      {snapshot.confirmation && <DeleteConfirmation hidden={hidden} />}
    </>
  );
}
