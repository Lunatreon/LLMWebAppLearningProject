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
  function react(createdAt: string, reaction: Reaction, turnId?: number) {
    if (controller.getSnapshot().active === chatId) {
      void controller.react(createdAt, reaction, turnId);
    }
  }

  return messages.map((item, index) => (
    <ChatMessage
      key={
        item.turn_id
          ? `${item.turn_id}:${item.role}`
          : `${index}:${item.role}:${item.created_at || ''}`
      }
      item={item}
      pending={reactionPending.includes(`${chatId}:${item.created_at}`)}
      enabled={enabled}
      onReaction={react}
    />
  ));
});
