import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { loginReturnPath, featureFromPath, workspaceFromRoute } from '../../utils/routes';
import LoginForm from './LoginForm';
import AuthLayout from './AuthLayout';
import { reflectionPracticeId } from '../reflection/types';

export default function LoginPage() {
  const { session } = useSession();
  const location = useLocation();
  const returnTo = loginReturnPath(location.state, location.search);
  const searchParams = new URLSearchParams(location.search);
  searchParams.delete('view');
  const search = searchParams.size ? `?${searchParams}` : '';
  const workspace = workspaceFromRoute(featureFromPath(returnTo), location.state);
  const sourceState =
    returnTo === '/reflection' && reflectionPracticeId(location.state)
      ? { practiceId: reflectionPracticeId(location.state), reflectionResume: true }
      : {};
  if (session.status === 'authenticated')
    return (
      <Navigate
        replace
        to={{ pathname: session.termsRequired ? '/terms' : returnTo, search }}
        state={
          session.termsRequired
            ? { workspace, afterTerms: returnTo, ...sourceState }
            : { workspace, ...sourceState }
        }
      />
    );
  return (
    <AuthLayout mode="login">
      <LoginForm />
    </AuthLayout>
  );
}
