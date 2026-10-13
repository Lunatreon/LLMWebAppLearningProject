import type { ChatMessage as Message, Reaction } from './types';

interface Props {
  item: Message;
  pending: boolean;
  enabled: boolean;
  onReaction: (createdAt: string, reaction: Reaction) => void;
}

export default function ChatMessage({ item, pending, enabled, onReaction }: Props) {
  return (
    <article className={`message ${item.role === 'user' ? 'user' : 'assistant'}`}>
      {item.content}
      {item.role === 'assistant' && item.created_at && (
        <div className="reply-reactions">
          {[
            ['like', '👍', 'Helpful reply'],
            ['dislike', '👎', 'Unhelpful reply'],
          ].map(([value, symbol, label]) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={item.reaction === value}
              disabled={pending || !enabled}
              onClick={() =>
                onReaction(
                  item.created_at!,
                  item.reaction === value ? null : (value as 'like' | 'dislike'),
                )
              }
            >
              {symbol}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
