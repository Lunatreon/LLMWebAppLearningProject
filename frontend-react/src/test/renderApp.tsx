import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import type { SessionController } from '../services/sessionController';

// Auth choice, backend fixtures and source state stay visible in each feature test.
export function renderApp({
  session,
  path,
  state,
}: {
  session: SessionController;
  path: string;
  state?: object;
}) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <SessionProvider controller={session}>
            <FeedbackProvider>
              <App />
            </FeedbackProvider>
          </SessionProvider>
        ),
      },
    ],
    { initialEntries: [{ pathname: path, state }] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return { ...view, router };
}
