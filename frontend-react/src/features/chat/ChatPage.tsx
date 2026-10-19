import { useLayoutEffect, useRef } from 'react';
import { useChat } from './ChatContext';
import { emptyPrompts } from './types';
import ChatHistory from './ChatHistory';
import ChatComposer from './ChatComposer';
export default function ChatPage() {
  const { controller, snapshot } = useChat();
  const container = useRef<HTMLDivElement>(null),
    historyAnchor = useRef<{ height: number; top: number } | null>(null),
    follow = useRef(true),
    lastScroll = useRef(-1);
  const chat = snapshot.chats.find((item) => item.chat_id === snapshot.active),
    messages = chat?.messages || [];
  const q = snapshot.generation?.chatId === snapshot.active ? snapshot.generation : null;
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    if (lastScroll.current === snapshot.scrollVersion && historyAnchor.current) {
      node.scrollTop = historyAnchor.current.top + node.scrollHeight - historyAnchor.current.height;
      historyAnchor.current = null;
    } else if (lastScroll.current !== snapshot.scrollVersion || follow.current) {
      node.scrollTo({ top: node.scrollHeight });
      historyAnchor.current = null;
      follow.current = true;
    }
    lastScroll.current = snapshot.scrollVersion;
  }, [
    snapshot.scrollVersion,
    snapshot.generation?.shown,
    snapshot.error,
    snapshot.draft,
    messages,
  ]);
  return (
    <>
      <div
        ref={container}
        id="messages"
        className="messages"
        role="log"
        aria-label="Conversation messages"
        aria-busy={Boolean(q)}
        aria-live="polite"
        aria-atomic="false"
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {snapshot.loading && (
          <p className="empty-state" role="status">
            Loading conversation...
          </p>
        )}
        {!messages.length && !q && !snapshot.loading && (
          <section className="empty-chat">
            <span className="empty-chat-mark" aria-hidden="true">
              F
            </span>
            <h3>What would you like to understand?</h3>
            <p>
              You do not need a polished thought. Begin with the feeling, question, or moment that
              keeps returning.
            </p>
            <div className="prompt-suggestions">
              {emptyPrompts.map((text) => (
                <button key={text} type="button" onClick={() => controller.prompt(text)}>
                  {text}
                </button>
              ))}
            </div>
          </section>
        )}
        {chat?.next_before_position && (
          <button
            className="secondary-button"
            type="button"
            disabled={snapshot.historyLoading || Boolean(q)}
            onClick={() => {
              const node = container.current;
              if (node) historyAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
              void controller.loadOlder();
            }}
          >
            {snapshot.historyLoading ? 'Loading older messages...' : 'Load older messages'}
          </button>
        )}
        <ChatHistory
          messages={messages}
          chatId={snapshot.active}
          enabled={snapshot.enabled}
          reactionPending={snapshot.reactionPending}
          controller={controller}
        />
        {q && (
          <>
            <article className="message user">{q.context}</article>
            {q.shown ? (
              <article className="message assistant streaming-message">
                <span className="streaming-content">
                  {q.chunks.map((text, index) => (
                    <span className="streaming-chunk" key={index}>
                      {text}
                    </span>
                  ))}
                </span>
                <span className="streaming-cursor" aria-hidden="true" />
              </article>
            ) : (
              <article
                className="message assistant waiting-message"
                role="status"
                aria-label="FeelY - Weaving a reply"
              >
                <span className="waiting-label">FeelY - Weaving a reply</span>
                <span className="waiting-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </article>
            )}
          </>
        )}
        {snapshot.error && !snapshot.review && (
          <article id="chat-error" className="message assistant" role="alert">
            {snapshot.error}
            {!snapshot.mapAccess &&
              snapshot.errorStatus === 429 &&
              snapshot.error.toLowerCase().includes('free messages') && (
                <a className="message-upgrade-button" href="/account">
                  Subscribe with Stripe
                </a>
              )}
          </article>
        )}
      </div>
      <ChatComposer />
    </>
  );
}
