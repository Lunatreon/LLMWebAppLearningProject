import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ThemeToggle from '../../components/layout/ThemeToggle';
import { useAppearance } from '../../hooks/useAppearance';
import { useViewportHeight } from '../../hooks/useViewportHeight';

export default function AuthLayout({
  mode,
  children,
  search,
}: {
  mode: 'login' | 'register' | 'activate' | 'recovery';
  children: ReactNode;
  search?: string;
}) {
  const location = useLocation();
  const routeSearch = search ?? location.search;
  const paperMode = mode === 'activate' || mode === 'recovery';
  const { theme, toggleTheme } = useAppearance();
  useViewportHeight();
  let pageTitle = 'Login';
  let headingId = 'auth-heading';
  if (mode === 'register') {
    pageTitle = 'Register';
  } else if (mode === 'activate') {
    pageTitle = 'Activate';
    headingId = 'activation-heading';
  } else if (mode === 'recovery') {
    pageTitle = 'Reset password';
    headingId = 'recovery-heading';
  }
  const brand = (light = false) => (
    <Link
      className={`brand-lockup${light ? ' brand-lockup-light' : ''}`}
      to={{ pathname: '/chat', search: routeSearch }}
      aria-label="FeelY chat"
    >
      <span className="brand-symbol" aria-hidden="true">
        F
      </span>
      <span>FeelY</span>
    </Link>
  );
  return (
    <main className="shell">
      <section id="auth-view" className="auth-view">
        <title>{`FeelY Chat | ${pageTitle}`}</title>
        <meta name="theme-color" content={theme === 'light' ? '#fff4f7' : '#100f13'} />
        <div className="auth-story">
          {brand(true)}
          <div className="auth-story-copy">
            <p className="eyebrow eyebrow-light">Your private reflection space</p>
            <h1>Become your own creation.</h1>
            <p>
              Slow down, name what is happening, and find the next honest step through conversation.
            </p>
          </div>
          <p className="image-credit">A quieter place to hear yourself.</p>
        </div>
        <div className="auth-panel" aria-labelledby={headingId}>
          {!paperMode && (
            <>
              <ThemeToggle theme={theme} onToggle={toggleTheme} className="auth-theme-toggle" />
              <div className="auth-panel-brand">
                {brand()}
                <p>Mythic self-authorship, grounded in real conversation.</p>
              </div>
            </>
          )}
          {!paperMode && (
            <>
              <div className="auth-heading">
                <p className="eyebrow">Welcome</p>
                <h2 id="auth-heading">
                  {mode === 'register' ? 'Create your private space' : 'Return to your space'}
                </h2>
              </div>
              <div className="auth-tabs" role="tablist" aria-label="Account access">
                {(['login', 'register'] as const).map((tab) =>
                  mode === tab ? (
                    <button
                      key={tab}
                      id={`${tab}-tab`}
                      className="tab active"
                      type="button"
                      role="tab"
                      aria-selected="true"
                    >
                      {tab === 'login' ? 'Login' : 'Register'}
                    </button>
                  ) : (
                    <Link
                      key={tab}
                      id={`${tab}-tab`}
                      className="tab"
                      role="tab"
                      aria-selected="false"
                      to={{ pathname: `/${tab}`, search: location.search }}
                      state={location.state}
                    >
                      {tab === 'login' ? 'Login' : 'Register'}
                    </Link>
                  ),
                )}
              </div>
            </>
          )}
          {children}
        </div>
      </section>
    </main>
  );
}
