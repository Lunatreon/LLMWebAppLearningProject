import { useContext } from 'react';
import type { ReactNode } from 'react';
import { SessionContext } from '../../context/SessionContext';
import SessionNotice from '../../components/SessionNotice';
import type { Feature } from '../../types/navigation';

export default function TermsGate({
  feature,
  children,
}: {
  feature?: Feature;
  children: ReactNode;
}) {
  const context = useContext(SessionContext);
  if (
    feature &&
    context?.session.status === 'authenticated' &&
    context.session.termsRequired &&
    feature !== 'terms' &&
    feature !== 'account'
  ) {
    return (
      <div className="messages">
        <div className="message assistant">
          <SessionNotice />
        </div>
      </div>
    );
  }
  return children;
}
