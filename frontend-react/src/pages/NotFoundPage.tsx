import { Link, useLocation } from 'react-router-dom';

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="messages">
      <div className="message assistant">
        <h3>Page not found</h3>
        <p>This page is unavailable.</p>
        <Link className="secondary-button" to={{ pathname: '/chat', search: location.search }}>
          Return to FeelY
        </Link>
      </div>
    </div>
  );
}
