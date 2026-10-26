import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { hasMapAccess } from '../../services/capabilities';
import { topicCategories, topicCategoryOf } from '../../types/map';
import { useMap } from './MapContext';
import { mapNodes, plurals } from './mapLayout';
import type { MapFilter } from './mapLayout';
import MapCanvas from './MapCanvas';
import MapDetails from './MapDetails';
export default function MapPage() {
  const { controller, snapshot } = useMap();
  const { session, controller: sessionController } = useSession();
  const location = useLocation();
  const allowed =
    session.status === 'authenticated' && hasMapAccess(session.subscription) && !snapshot.denied;
  const topics = snapshot.data?.topic_spaces || [];
  const categoryFilters: Record<string, string> = snapshot.data?.categories
    ? Object.fromEntries(
        snapshot.data.categories
          .filter(
            (c) => c.kind === 'topic' && (c.active || topics.some((t) => t.category === c.key)),
          )
          .map((c) => [c.key, c.label]),
      )
    : plurals;
  const active = snapshot.data
    ? mapNodes(snapshot.data).find((node) => node.id === snapshot.selected)
    : null;
  const summary = topics.length
    ? Object.entries(categoryFilters)
        .map(([category, plural]) => {
          const count = topics.filter((topic) => topicCategoryOf(topic) === category).length;
          return count
            ? `${count} ${count === 1 ? (snapshot.data?.categories?.find((c) => c.kind === 'topic' && c.key === category)?.label || topicCategories[category] || category).toLowerCase() : plural.toLowerCase()}`
            : null;
        })
        .filter(Boolean)
        .join(' · ')
    : 'The people, qualities, and experiences that make up your life.';
  return (
    <div id="map-content" className="map-content">
      {!allowed ? (
        <section className="map-paywall">
          <span className="map-paywall-badge">Premium</span>
          <h3>Turn conversations into your personal map</h3>
          <p>
            My Map connects the reflections you choose to keep into a map of yourself and your
            journey.
          </p>
          <ul>
            <li>See recurring themes across conversations</li>
            <li>Keep useful insights organized in one visual space</li>
            <li>Revisit what matters to you and how your perspective changes</li>
          </ul>
          <div className="map-paywall-actions">
            <a className="primary-button" href="/account">
              {session.status === 'authenticated' &&
              session.subscription.available_plans.includes('monthly')
                ? 'Unlock My Map'
                : 'View Premium'}
            </a>
            <Link className="secondary-button" to={{ pathname: '/chat', search: location.search }}>
              Continue with chat
            </Link>
          </div>
          {snapshot.denied && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void sessionController.reload({ force: true })}
            >
              Check access again
            </button>
          )}
        </section>
      ) : (
        <>
          {snapshot.loading && (
            <p className="map-empty" role="status">
              Loading My Map...
            </p>
          )}
          {(snapshot.loadError || snapshot.error) && !snapshot.popup && (
            <div className="map-empty">
              <p role="alert">{snapshot.loadError || snapshot.error}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void controller.load(true)}
              >
                Retry map
              </button>
              {snapshot.errorStatus === 403 && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void sessionController.reload({ force: true })}
                >
                  Check session again
                </button>
              )}
            </div>
          )}
          {snapshot.data && (
            <section className="map-concept-layout">
              <div className="map-toolbar">
                <p className="map-topic-summary">{summary}</p>
                <div className="map-topic-filters" role="group" aria-label="Filter map topics">
                  {[['all', 'Everything'], ...Object.entries(categoryFilters)].map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={snapshot.filter === value}
                        onClick={() => controller.filter(value as MapFilter)}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <MapCanvas />
              <div className={`map-detail-drawer${snapshot.detailOpen && active ? '' : ' hidden'}`}>
                {snapshot.detailOpen && active && <MapDetails key={active.id} node={active} />}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
