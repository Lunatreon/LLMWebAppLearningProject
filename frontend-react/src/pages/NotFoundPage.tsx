import { Link, useLocation } from 'react-router-dom';
import { legacyAppUrl } from '../services/config';

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="messages">
      <div className="message assistant">
        <h3>Page unavailable in this preview</h3>
        <p>Use the reference website for features that are still being migrated.</p>
        <p>
          <Link className="secondary-button" to={{ pathname: '/chat', search: location.search }}>
            Return to preview
          </Link>
        </p>
        <a
          className="secondary-button"
          href={legacyAppUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open reference website
        </a>
      </div>
    </div>
  );
}
