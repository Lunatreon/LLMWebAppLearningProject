import { Navigate, useLocation } from 'react-router-dom';
import { featureRoutes } from '../utils/routes';

export default function LegacyEntryRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'register') {
    params.delete('mode');
    return (
      <Navigate
        replace
        to={{ pathname: '/register', search: params.size ? `?${params}` : '', hash: location.hash }}
      />
    );
  }
  const view = params.get('view') ?? 'chat';
  const feature = Object.hasOwn(featureRoutes, view) ? view : 'chat';
  params.delete('view');
  const search = params.toString();
  return (
    <Navigate
      replace
      to={{ pathname: `/${feature}`, search: search ? `?${search}` : '', hash: location.hash }}
    />
  );
}
