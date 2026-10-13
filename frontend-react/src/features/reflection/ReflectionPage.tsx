import { Link, useLocation } from 'react-router-dom';
import MapPage from '../map/MapPage';
import { useReflection } from './ReflectionContext';
import { reflectionPracticeId } from './types';
export default function ReflectionPage() {
  const location = useLocation(),
    { snapshot } = useReflection();
  return (
    <>
      <MapPage />
      {!reflectionPracticeId(location.state) && snapshot.enabled && (
        <div className="messages">
          <div className="message assistant">
            <p>Choose a practice in My Map to reflect on.</p>
            <Link
              className="secondary-button"
              to={{ pathname: '/map', search: location.search }}
              replace
            >
              Return to My Map
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
