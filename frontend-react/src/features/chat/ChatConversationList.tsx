import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatContext } from './ChatContext';
export default function ChatConversationList({
  onNavigate,
  onClose,
}: {
  onNavigate: () => void;
  onClose: () => void;
}) {
  const chat = useContext(ChatContext);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  if (!chat)
    return (
      <div id="chat-sidebar-content" className="sidebar-context">
        <button id="new-chat-button" className="new-chat-button" type="button" onClick={onNavigate}>
          <span className="button-icon" aria-hidden="true">
            +
          </span>
          <span>New conversation</span>
        </button>
        <div className="chat-list-heading">
          <span>Conversations</span>
          <span id="chat-count">0</span>
        </div>
        <nav id="chat-list" className="chat-list" aria-label="Chats">
          <p className="empty-state">Conversations are not loaded in this preview.</p>
        </nav>
      </div>
    );
  const { controller, snapshot } = chat;
  return (
    <div id="chat-sidebar-content" className="sidebar-context">
      <button
        id="new-chat-button"
        className="new-chat-button"
        type="button"
        disabled={!snapshot.enabled}
        onClick={() => {
          controller.newConversation();
          onNavigate();
        }}
      >
        <span className="button-icon" aria-hidden="true">
          +
        </span>
        <span>New conversation</span>
      </button>
      <div className="chat-list-heading">
        <span>Conversations</span>
        <span id="chat-count">{snapshot.chats.length}</span>
      </div>
      <nav
        id="chat-list"
        className="chat-list"
        aria-label="Chats"
        onScroll={() => controller.closeMenu()}
      >
        {snapshot.listLoading && (
          <p className="empty-state" role="status">
            Loading conversations...
          </p>
        )}
        {snapshot.listError && (
          <div className="empty-state">
            <p role="alert">{snapshot.listError}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void controller.loadList()}
            >
              Retry conversations
            </button>
          </div>
        )}
        {!snapshot.listLoading && !snapshot.chats.length && !snapshot.listError && (
          <p className="empty-state">Your conversations will appear here.</p>
        )}
        {snapshot.chats.map((item) => {
          const count = item.message_count || item.messages.length || 0,
            title = item.title || 'New conversation';
          return (
            <div key={item.chat_id} className="chat-list-item">
              <button
                className={`chat-open-button${snapshot.active === item.chat_id ? ' active' : ''}`}
                type="button"
                aria-current={snapshot.active === item.chat_id ? 'page' : 'false'}
                aria-label={`${title} ${count} ${count === 1 ? 'message' : 'messages'}`}
                onClick={() => {
                  onNavigate();
                  void controller.select(item.chat_id).then((selected) => {
                    if (selected) onClose();
                  });
                }}
              >
                <strong>{title}</strong>
                <span>
                  {count} {count === 1 ? 'message' : 'messages'}
                </span>
              </button>
              <button
                className="chat-actions-button"
                type="button"
                title={`More options for ${title}`}
                aria-label={`More options for ${title}`}
                aria-haspopup="menu"
                aria-expanded={snapshot.menu === item.chat_id}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPosition({
                    left: Math.max(8, rect.right - 150),
                    top: Math.max(
                      8,
                      rect.bottom + 5 + 44 < window.innerHeight ? rect.bottom + 5 : rect.top - 49,
                    ),
                  });
                  controller.toggleMenu(item.chat_id);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </div>
          );
        })}
        {snapshot.listNextCursor && (
          <button
            className="secondary-button"
            type="button"
            disabled={snapshot.listLoading}
            onClick={() => void controller.loadList(true)}
          >
            Load more conversations
          </button>
        )}
      </nav>
      {snapshot.menu &&
        createPortal(
          <div
            className="chat-actions-menu"
            role="menu"
            aria-label={`Actions for ${snapshot.chats.find((item) => item.chat_id === snapshot.menu)?.title || 'conversation'}`}
            style={position}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') controller.closeMenu();
            }}
          >
            <button
              className="chat-menu-delete"
              type="button"
              role="menuitem"
              autoFocus
              disabled={Boolean(snapshot.deleting)}
              onClick={() => controller.confirmDelete(snapshot.menu!)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" />
              </svg>
              <span>Delete</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
