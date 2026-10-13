import { useLocation } from 'react-router-dom';
import AuthLayout from '../AuthLayout';
import { recoverySearch } from './resetLink';
import ForgotPasswordForm from './ForgotPasswordForm';

export default function ForgotPasswordPage() {
  const location = useLocation();
  return (
    <AuthLayout mode="recovery" search={recoverySearch(location.search)}>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
