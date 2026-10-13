import { useLocation } from 'react-router-dom';
import AuthLayout from '../AuthLayout';
import { recoverySearch } from './resetLink';
import ResetPasswordForm from './ResetPasswordForm';

export default function ResetPasswordPage() {
  const location = useLocation();
  return (
    <AuthLayout mode="recovery" search={recoverySearch(location.search)}>
      <ResetPasswordForm />
    </AuthLayout>
  );
}
