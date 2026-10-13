import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ChatHistory from '../features/chat/ChatHistory';
import { ChatController } from '../features/chat/ChatController';
import { SessionController } from '../services/sessionController';
import { chat } from './chatBackend';

const calls = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock('../features/chat/ChatMessage', async (original) => {
  const module = await original<typeof import('../features/chat/ChatMessage')>();
  return {
    default: (props: ComponentProps<typeof module.default>) => {
      calls.message();
      return <module.default {...props} />;
    },
  };
});

describe('saved Chat history presentation', () => {
  test('unchanged history does not rerender saved messages for unrelated parent updates', () => {
    calls.message.mockClear();
    const session = new SessionController('http://api.test');
    const controller = new ChatController(session);
    const messages = chat('a', 'A', 'Saved text').messages;
    const pending: string[] = [];
    const props = { messages, controller, reactionPending: pending, enabled: true, chatId: null };
    const view = render(<ChatHistory {...props} />);
    const initial = calls.message.mock.calls.length;
    view.rerender(<ChatHistory {...props} />);
    view.rerender(<ChatHistory {...props} />);
    expect(calls.message.mock.calls.length).toBe(initial);
    expect(screen.getByText('Saved text')).toBeDefined();
    controller.stop();
    session.stop();
  });
  test('reaction pending changes still refresh the controls and canonical reaction display', () => {
    const session = new SessionController('http://api.test');
    const controller = new ChatController(session);
    const messages = chat('a', 'A', 'Saved text').messages;
    const props = { messages, controller, enabled: true, chatId: 'a' };
    const view = render(<ChatHistory {...props} reactionPending={[]} />);
    expect(
      (screen.getByRole('button', { name: 'Helpful reply' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    view.rerender(<ChatHistory {...props} reactionPending={['a:2026-10-12T12:00:00Z']} />);
    expect(
      (screen.getByRole('button', { name: 'Helpful reply' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    controller.stop();
    session.stop();
  });
  test('a reaction event from a previous conversation cannot target the current conversation', () => {
    const session = new SessionController('http://api.test');
    const controller = new ChatController(session);
    const reacting = vi.spyOn(controller, 'react').mockResolvedValue(undefined);
    render(
      <ChatHistory
        messages={chat('a', 'A', 'Saved text').messages}
        controller={controller}
        enabled
        chatId="a"
        reactionPending={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Helpful reply' }));
    expect(reacting).not.toHaveBeenCalled();
    controller.stop();
    session.stop();
  });
});
