import { expect, test } from 'vitest';
import { chat, generation, streamResponse } from './chatBackend';
import { json } from './backend';
import { setup, tick } from './chatControllerHarness';

const pair = (position: number) => [
  {
    role: 'user',
    content: `Input ${position}`,
    position,
    turn_id: position,
    created_at: `2026-01-01T00:00:${position}Z`,
  },
  {
    role: 'assistant',
    content: `Reply ${position}`,
    position,
    turn_id: position,
    created_at: `2026-01-01T00:00:${position}Z`,
  },
];

test('metadata list pages append without replacing loaded conversation history', async () => {
  const { controller, fetch } = await setup({
    list: () => json({ items: [chat('a')], next_cursor: 'next-page' }),
    read: () => json({ ...chat('a'), messages: pair(50), next_before_position: 50 }),
  });
  expect(controller.getSnapshot().listNextCursor).toBe('next-page');
  await controller.select('a');
  await tick();
  fetch.mockResolvedValueOnce(json({ items: [chat('b')], next_cursor: null }));
  await controller.loadList(true);
  expect(controller.getSnapshot().chats.map((c) => c.chat_id)).toEqual(['a', 'b']);
  expect(controller.getSnapshot().chats[0].messages).toEqual(pair(50));
  expect(controller.getSnapshot().listNextCursor).toBeNull();
  expect(
    String(fetch.mock.calls.find((call) => String(call[0]).includes('cursor=next-page'))?.[0]),
  ).toContain('paginated=true');
});

test('older message pages are prepended once and retained on metadata refresh', async () => {
  const { controller, fetch } = await setup({
    initial: [chat('a')],
    read: () => json({ ...chat('a'), messages: pair(50), next_before_position: 50 }),
  });
  await controller.select('a');
  await tick();
  fetch.mockResolvedValueOnce(
    json({ ...chat('a'), messages: pair(49), next_before_position: null }),
  );
  await controller.loadOlder();
  expect(controller.getSnapshot().chats[0].messages).toEqual([...pair(49), ...pair(50)]);
  expect(controller.getSnapshot().chats[0].next_before_position).toBeNull();
  await controller.loadList();
  expect(controller.getSnapshot().chats[0].messages).toHaveLength(4);
  const count = fetch.mock.calls.length;
  await controller.loadOlder();
  expect(fetch.mock.calls).toHaveLength(count);
});

test('a delayed older page cannot appear after navigating to a different conversation', async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { controller, fetch } = await setup({
    initial: [chat('a'), chat('b')],
    read: (id) => json({ ...chat(id), messages: pair(50), next_before_position: 50 }),
  });
  await controller.select('a');
  await tick();
  fetch.mockReturnValueOnce(pending);
  const older = controller.loadOlder();
  await controller.select('b');
  finish(json({ ...chat('a'), messages: pair(49), next_before_position: null }));
  await older;
  expect(controller.getSnapshot().active).toBe('b');
  expect(controller.getSnapshot().chats.find((c) => c.chat_id === 'b')?.messages).toEqual(pair(50));
  expect(controller.getSnapshot().historyLoading).toBe(false);
});

test('sending retains the cursor for history outside the returned model context', async () => {
  const { controller } = await setup({
    initial: [chat('a')],
    read: () =>
      json({ ...chat('a'), message_count: 100, messages: pair(100), next_before_position: 100 }),
    stream: (_id, context) => {
      const result = generation({ ...chat('a'), message_count: 100 }, context, 'Reply 101');
      result.turn_id = 101;
      result.chat_info.messages = Array.from({ length: 12 }, (_, index) => pair(90 + index)).flat();
      result.chat_info.next_before_position = 90;
      return streamResponse([{ type: 'result', data: result }]);
    },
  });
  await controller.select('a');
  await tick();
  controller.edit('Input 101');
  expect(await controller.send()).toBe(true);
  expect(controller.getSnapshot().chats[0].next_before_position).toBe(90);
  expect(controller.getSnapshot().chats[0].messages).toHaveLength(24);
});
