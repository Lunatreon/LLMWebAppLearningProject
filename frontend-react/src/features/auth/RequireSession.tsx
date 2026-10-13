import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SessionContext } from '../../context/SessionContext';
import SessionNotice from '../../components/SessionNotice';
import { featureFromPath, workspaceFromRoute } from '../../utils/routes';

export default function RequireSession({ children }: { children: ReactNode }) {
  const context = useContext(SessionContext);
  const location = useLocation();
  if (!context) return children; // Historical layout-only fixtures, never production.
  if (context.session.status === 'unauthenticated')
    return (
      <Navigate
        replace
        to={{ pathname: '/login', search: location.search }}
        state={{
          afterLogin: location.pathname,
          workspace: workspaceFromRoute(featureFromPath(location.pathname), location.state),
        }}
      />
    );
  if (context.session.status !== 'authenticated')
    return (
      <div className="messages">
        <SessionNotice />
      </div>
    );
  return children;
}
