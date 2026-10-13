import { lazy, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContext } from '../../features/map/MapContext';
import { ChatContext } from '../../features/chat/ChatContext';
import { ReflectionContext } from '../../features/reflection/ReflectionContext';
import ViewBoundary from '../shared/ViewBoundary';

const MapForms = lazy(() => import('../../features/map/MapForms'));
const ChatReviews = lazy(() => import('../../features/chat/ChatReviews'));
const ReflectionForm = lazy(() => import('../../features/reflection/ReflectionForm'));

// Providers retain drafts/requests; only the presentation is loaded on demand.
export default function FeatureDialogs() {
  const map = useContext(MapContext);
  const chat = useContext(ChatContext);
  const reflection = useContext(ReflectionContext);
  const location = useLocation();
  const navigate = useNavigate();
  const termsRoute = location.pathname === '/terms';

  return (
    <>
      {map && location.pathname === '/map' && (map.snapshot.popup || map.snapshot.confirmation) && (
        <ViewBoundary
          onClose={() => {
            map.controller.cancelConfirmation();
            map.controller.closePopup();
          }}
        >
          <MapForms />
        </ViewBoundary>
      )}
      {chat &&
        (location.pathname === '/chat' || termsRoute) &&
        (chat.snapshot.review || chat.snapshot.confirmation) && (
          <ViewBoundary
            onClose={() => {
              chat.controller.closeReview();
              chat.controller.closeConfirmation();
            }}
          >
            <ChatReviews hidden={location.pathname !== '/chat' || !chat.snapshot.enabled} />
          </ViewBoundary>
        )}
      {reflection?.snapshot.id && (location.pathname === '/reflection' || termsRoute) && (
        <ViewBoundary
          onClose={() => {
            reflection.controller.close();
            navigate({ pathname: '/map', search: location.search }, { replace: true });
          }}
        >
          <ReflectionForm
            hidden={location.pathname !== '/reflection' || !reflection.snapshot.enabled}
          />
        </ViewBoundary>
      )}
    </>
  );
}
