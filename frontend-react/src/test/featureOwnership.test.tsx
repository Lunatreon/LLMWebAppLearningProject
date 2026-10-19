import { useContext, useLayoutEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { SessionContext } from '../context/SessionContext';
import { SessionController } from '../services/sessionController';
import { MapProvider, useMap } from '../features/map/MapContext';
import { mapBackend, mapData, topic } from './mapBackend';
import { jwt } from './backend';

describe('synchronous feature ownership projections', () => {
  test('Map never commits previous-owner data between a new session and provider effects', async () => {
    localStorage.setItem('feely_token', jwt());
    const backend = mapBackend({ initial: mapData([topic('old', 'Private old topic')]) });
    const session = new SessionController('http://127.0.0.1:8000/api/v1');
    await session.reload();
    const before = { ...session.getSnapshot(), controller: session };
    if (before.session.status !== 'authenticated') throw new Error('Fixture session did not load');
    const leaked: string[] = [];
    function Probe() {
      const { snapshot } = useMap();
      const owner = useContext(SessionContext)!;
      const title = snapshot.data?.topic_spaces[0]?.title || '';
      useLayoutEffect(() => {
        if (owner.session.token !== before.session.token && title) leaked.push(title);
      });
      return <p>{title || 'No topic'}</p>;
    }
    const view = render(
      <SessionContext.Provider value={before}>
        <MemoryRouter initialEntries={['/map']}>
          <MapProvider>
            <Probe />
          </MapProvider>
        </MemoryRouter>
      </SessionContext.Provider>,
    );
    await screen.findByText('Private old topic');
    backend.setData(mapData());
    const nextToken = jwt(undefined, 'next');
    vi.spyOn(session, 'getToken').mockReturnValue(nextToken);
    const after = { ...before, session: { ...before.session, token: nextToken } };
    await act(async () =>
      view.rerender(
        <SessionContext.Provider value={after}>
          <MemoryRouter initialEntries={['/map']}>
            <MapProvider>
              <Probe />
            </MapProvider>
          </MemoryRouter>
        </SessionContext.Provider>,
      ),
    );
    expect(leaked).toEqual([]);
    await screen.findByText('No topic');
    view.unmount();
    session.stop();
  });
});
