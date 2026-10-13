import { useSession } from '../../../hooks/useSession';
import AuthLayout from '../AuthLayout';
import LoginPage from '../LoginPage';
import RegistrationForm from './RegistrationForm';

export default function RegistrationPage() {
  const { session } = useSession();
  // Reuse the established authenticated-destination/Terms policy unchanged.
  if (session.status === 'authenticated') return <LoginPage />;
  return (
    <AuthLayout mode="register">
      <RegistrationForm />
    </AuthLayout>
  );
}
