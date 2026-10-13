import { useContext } from 'react';
import { SessionContext } from '../context/SessionContext';

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('SessionProvider is required.');
  return context;
}
