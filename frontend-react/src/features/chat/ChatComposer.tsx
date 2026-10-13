import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChat } from './ChatContext';
import { useSession } from '../../hooks/useSession';
import { referenceAccountUrl } from '../../services/referenceFrontend';
import { lenses } from './types';
export default function ChatComposer() {
  const { controller, snapshot } = useChat();
  const { session } = useSession();
  const input = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState<number>();
  const [lensOpen, setLensOpen] = useState(false);
  const maximum = Math.max(
    84,
    Math.min(240, Math.floor((window.visualViewport?.height || window.innerHeight) * 0.3)),
  );
  useLayoutEffect(() => {
    if (input.current) setHeight(Math.min(input.current.scrollHeight || 42, maximum));
  }, [snapshot.draft, maximum]);
  useLayoutEffect(() => {
    if (snapshot.focusVersion) input.current?.focus();
  }, [snapshot.focusVersion]);
  const active = Boolean(snapshot.generation && snapshot.generation.chatId === snapshot.active);
  const limit =
    session.status === 'authenticated' ? session.subscription.chat_daily_limit || 10 : 10;
  let plan: string;
  if (session.status === 'authenticated' && session.subscription.free_test_phase) {
    plan = 'Now for free - All features during the test phase';
  } else if (snapshot.mapAccess) {
    plan = `Premium - up to ${limit} messages per day.`;
  } else {
    plan = `Free plan - ${limit} messages per day.`;
  }
  const chat = snapshot.chats.find((item) => item.chat_id === snapshot.active);
  return (
    <footer className="composer-zone">
      <div className="chat-suggestion-notices" aria-label="Suggestions to review">
        {snapshot.analysisStatus === 'error' && (
          <button
            id="map-analysis-retry"
            className="suggestion-review"
            type="button"
            disabled={snapshot.retryPending}
            onClick={() => void controller.retryAnalysis()}
          >
            {snapshot.retryError
              ? 'Could not retry. Try again shortly'
              : 'Map suggestions failed. Retry'}
          </button>
        )}
        {chat?.pending_topic && (
          <button
            id="topic-review"
            className="suggestion-review"
            type="button"
            aria-haspopup="dialog"
            aria-controls="topic-review-dialog"
            onClick={() => controller.openReview('topic')}
          >
            Review topic: {chat.pending_topic.topic || 'New topic'}
          </button>
        )}
        {snapshot.mapAccess && chat?.pending_map_suggestion && (
          <button
            id="map-suggestion-review"
            className="suggestion-review"
            type="button"
            aria-haspopup="dialog"
            aria-controls="map-suggestion-review-dialog"
            onClick={() => controller.openReview('note')}
          >
            Review map note
          </button>
        )}
      </div>
      {lensOpen && (
        <section id="lens-panel" className="lens-panel" aria-label="Reflection lenses">
          {lenses.map((lens) => (
            <button
              key={lens.name}
              type="button"
              aria-label={`${lens.name} ${lens.label}`}
              onClick={() => {
                controller.prompt(
                  snapshot.draft.trim() ? `${snapshot.draft.trim()}\n\n${lens.text}` : lens.text,
                );
                setLensOpen(false);
              }}
            >
              <strong>{lens.name}</strong>
              <span>{lens.label}</span>
            </button>
          ))}
        </section>
      )}
      <form
        id="message-form"
        className="message-form"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.send();
        }}
      >
        <textarea
          aria-describedby="chat-error"
          ref={input}
          id="message-input"
          rows={1}
          placeholder="Write what is on your mind..."
          title="Enter for a new line. Ctrl+Enter or Command+Enter to send."
          aria-label="Message FeelY"
          value={snapshot.draft}
          disabled={!snapshot.enabled}
          style={{ height, maxHeight: maximum, overflowY: height === maximum ? 'auto' : 'hidden' }}
          onChange={(event) => {
            setHeight(undefined);
            controller.edit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.ctrlKey || event.metaKey) &&
              !event.nativeEvent.isComposing &&
              !snapshot.generation &&
              !snapshot.preflight
            ) {
              event.preventDefault();
              void controller.send();
            }
          }}
        />
        <button
          id="send-button"
          className={`send-button${active ? ' is-stopping' : ''}`}
          type="submit"
          title={active ? 'Stop response' : 'Send message'}
          aria-label={active ? 'Stop response' : 'Send message'}
          disabled={
            !snapshot.enabled ||
            (!active && (snapshot.loading || snapshot.preflight || Boolean(snapshot.generation)))
          }
        >
          {active ? (
            <span className="stop-square" aria-hidden="true" />
          ) : (
            <span aria-hidden="true">↑</span>
          )}
        </button>
      </form>
      <div className="composer-meta">
        <button
          id="lens-toggle"
          className="lens-toggle"
          type="button"
          aria-expanded={lensOpen}
          onClick={() => setLensOpen((value) => !value)}
        >
          Three lenses
        </button>
        <span id="chat-plan-note" className="chat-plan-note">
          <span id="chat-plan-copy">{plan}</span>
          {!snapshot.mapAccess && (
            <a
              id="chat-plan-upgrade"
              className="chat-plan-upgrade"
              href={referenceAccountUrl()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Want more? Click here.
            </a>
          )}
        </span>
        <p className="composer-note">
          FeelY can help you reflect, but it is not emergency or medical care.
        </p>
      </div>
      {snapshot.errorStatus === 403 && snapshot.error.includes('verify your email') && (
        <Link to="/activate" state={{ afterLogin: '/chat' }}>
          Activate account / enter email PIN
        </Link>
      )}
    </footer>
  );
}
