import { useSession } from '../../../hooks/useSession';
import AuthLayout from '../AuthLayout';
import LoginPage from '../LoginPage';
import ActivationForm from './ActivationForm';

export default function ActivationPage() {
  const { session } = useSession();
  if (session.status === 'authenticated' && session.account.is_email_verified) return <LoginPage />;
  return (
    <AuthLayout mode="activate">
      <ActivationForm />
    </AuthLayout>
  );
}
