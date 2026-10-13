import { memo } from 'react';
import type { ChatController } from './ChatController';
import type { ChatMessage as Message, Reaction } from './types';
import ChatMessage from './ChatMessage';

interface Props {
  messages: Message[];
  chatId: string | null;
  enabled: boolean;
  reactionPending: string[];
  controller: ChatController;
}

// Saved messages do not subscribe to streamed text/composer changes.
export default memo(function ChatHistory({
  messages,
  chatId,
  enabled,
  reactionPending,
  controller,
}: Props) {
  function react(createdAt: string, reaction: Reaction) {
    if (controller.getSnapshot().active === chatId) {
      void controller.react(createdAt, reaction);
    }
  }

  return messages.map((item, index) => (
    <ChatMessage
      key={`${index}:${item.role}:${item.created_at || ''}`}
      item={item}
      pending={reactionPending.includes(`${chatId}:${item.created_at}`)}
      enabled={enabled}
      onReaction={react}
    />
  ));
});
