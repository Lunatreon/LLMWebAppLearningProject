import { Link, useLocation } from 'react-router-dom';
import SessionNotice from '../../components/SessionNotice';
import { useSession } from '../../hooks/useSession';
import { workspaceReturnPath, workspaceFromRoute } from '../../utils/routes';
import AccountSummary, { AccountHeader } from './AccountSummary';
import ProfileForm from './ProfileForm';
import DeleteAccount from './DeleteAccount';
import ChangePasswordForm from './password/ChangePasswordForm';

export default function AccountPage() {
  const { session } = useSession();
  const location = useLocation();
  const workspace = workspaceFromRoute('account', location.state);
  return (
    <div className="messages">
      <section
        id="account-dialog"
        className="app-dialog account-dialog account-page"
        aria-label="Account settings"
      >
        <Link
          className="dialog-close account-dialog-close"
          to={{
            pathname: workspaceReturnPath(workspace, location.state),
            search: location.search,
          }}
          aria-label="Close"
        >
          ×
        </Link>
        <AccountHeader account={session.status === 'authenticated' ? session.account : undefined} />
        <div className="account-dialog-body">
          <p>
            <Link
              to={{ pathname: '/terms', search: location.search }}
              state={{ workspace, afterTerms: '/account' }}
            >
              Read FeelY terms of use (AGB)
            </Link>
          </p>
          <SessionNotice />
          {session.status === 'authenticated' && (
            <>
              <ProfileForm
                key={`${session.token}:${session.account.id}`}
                account={session.account}
                token={session.token}
              />
              <ChangePasswordForm
                key={`password:${session.token}:${session.account.id}`}
                account={session.account}
                token={session.token}
              />
              <AccountSummary subscription={session.subscription} />
              <DeleteAccount
                key={`delete:${session.token}:${session.account.id}`}
                account={session.account}
                token={session.token}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
