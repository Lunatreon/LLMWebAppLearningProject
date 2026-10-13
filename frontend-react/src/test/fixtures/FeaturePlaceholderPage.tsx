import { Link, useLocation } from 'react-router-dom';
import { legacyAppUrl } from '../../services/config';
import SessionNotice from '../../components/SessionNotice';
import type { Feature } from '../../types/navigation';
import { workspaceReturnPath, workspaceFromRoute } from '../../utils/routes';

interface Props {
  feature: Feature;
}

export default function FeaturePlaceholderPage({ feature }: Props) {
  const location = useLocation();
  const workspace = workspaceFromRoute(feature, location.state);
  const secondary = feature === 'account' || feature === 'feedback' || feature === 'reflection';
  const legacyUrl = new URL(legacyAppUrl);
  if (feature === 'map' || feature === 'journal' || feature === 'account')
    legacyUrl.searchParams.set('view', feature);

  return (
    <div className="messages">
      <div className="message assistant">
        <h3>Shared shell active</h3>
        <p>
          This {feature} page is not migrated yet. Navigation and appearance controls work; feature
          content remains in the reference website.
        </p>
        <p>Feature data is not loaded in this preview.</p>
        <SessionNotice />
        {feature === 'account' && (
          <p>
            <Link
              to={{ pathname: '/terms', search: location.search }}
              state={{ workspace, afterTerms: '/account' }}
            >
              Read FeelY terms of use (AGB)
            </Link>
          </p>
        )}
        <p>
          <a
            className="secondary-button"
            href={legacyUrl.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open reference website
          </a>
        </p>
        {secondary && (
          <p>
            <Link
              className="secondary-button"
              to={{
                pathname: workspaceReturnPath(workspace, location.state),
                search: location.search,
              }}
            >
              Return to workspace
            </Link>
          </p>
        )}
        {feature === 'map' && (
          <p>
            <Link
              className="secondary-button"
              to={{ pathname: '/reflection', search: location.search }}
              state={{ workspace: 'map', returnTo: '/map' }}
            >
              Preview reflection navigation
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
