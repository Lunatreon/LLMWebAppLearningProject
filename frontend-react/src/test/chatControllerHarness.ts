import { afterEach } from 'vitest';
import { SessionController } from '../services/sessionController';
import { ChatController } from '../features/chat/ChatController';
import { chatBackend } from './chatBackend';
import { jwt } from './backend';

const instances: { session: SessionController; controller: ChatController }[] = [];
afterEach(() =>
  instances.splice(0).forEach((value) => {
    value.controller.stop();
    value.session.stop();
  }),
);
export async function setup(options: Parameters<typeof chatBackend>[0] = {}) {
  localStorage.setItem('feely_token', jwt());
  const backend = chatBackend(options);
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  await session.reload();
  const controller = new ChatController(session);
  controller.configure(session.getToken(), true, true);
  controller.setVisible(true, true);
  instances.push({ session, controller });
  await controller.loadList();
  return { ...backend, session, controller };
}
export const tick = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
