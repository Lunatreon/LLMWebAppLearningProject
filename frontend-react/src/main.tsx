import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import './styles/index.css';
import { SessionProvider } from './context/SessionContext';
import { FeedbackProvider } from './features/feedback/FeedbackContext';

// React's required mount point; document appearance/viewport integration lives
// in lifecycle hooks. Navigation and rendering remain declarative.
const root = document.getElementById('root');
if (!root) throw new Error('The FeelY application mount point is missing.');

const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <SessionProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </SessionProvider>
    ),
  },
]);
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
