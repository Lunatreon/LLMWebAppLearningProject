import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import NotFoundPage from './pages/NotFoundPage';
import LegacyEntryRedirect from './pages/LegacyEntryRedirect';
import type { ShellSession } from './types/navigation';
import type { ReactNode } from 'react';
import { lazy } from 'react';
import FeatureDialogs from './components/layout/FeatureDialogs';
import ViewBoundary from './components/shared/ViewBoundary';
import TermsPage from './features/terms/TermsPage';
import RequireSession from './features/auth/RequireSession';
import ResetPasswordPage from './features/auth/recovery/ResetPasswordPage';
import { resetTokenParameter } from './features/auth/recovery/resetLink';
import { JournalProvider } from './features/journal/JournalContext';
import { MapProvider } from './features/map/MapContext';
import { ReflectionProvider } from './features/reflection/ReflectionContext';
import { ChatProvider } from './features/chat/ChatContext';
import ActivationLinkPage from './features/auth/activation/ActivationLinkPage';
const FeedbackPage = lazy(() => import('./features/feedback/FeedbackPage'));
const AccountPage = lazy(() => import('./features/account/AccountPage'));
const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegistrationPage = lazy(() => import('./features/auth/registration/RegistrationPage'));
const ActivationPage = lazy(() => import('./features/auth/activation/ActivationPage'));
const ForgotPasswordPage = lazy(() => import('./features/auth/recovery/ForgotPasswordPage'));
const JournalPage = lazy(() => import('./features/journal/JournalPage'));
const MapPage = lazy(() => import('./features/map/MapPage'));
const ReflectionPage = lazy(() => import('./features/reflection/ReflectionPage'));
const ChatPage = lazy(() => import('./features/chat/ChatPage'));

function TermsAlias() {
  const location = useLocation();
  return (
    <Navigate replace to={{ pathname: '/terms', search: location.search, hash: location.hash }} />
  );
}

// Optional layout inputs/route slot isolate the historical shell unit tests.
// Production supplies none: session data and feature pages are always real.
type AppProps = {
  session?: ShellSession;
  feedbackElement?: ReactNode;
  accountElement?: ReactNode;
  journalElement?: ReactNode;
  mapElement?: ReactNode;
  reflectionElement?: ReactNode;
  chatElement?: ReactNode;
};
export default function App(props: AppProps) {
  return (
    <JournalProvider>
      <MapProvider>
        <ChatProvider>
          <ReflectionProvider>
            <AppRoutes {...props} />
            <FeatureDialogs />
          </ReflectionProvider>
        </ChatProvider>
      </MapProvider>
    </JournalProvider>
  );
}
function AppRoutes({
  session,
  feedbackElement,
  accountElement,
  journalElement,
  mapElement,
  reflectionElement,
  chatElement,
}: AppProps) {
  const location = useLocation();
  // Keep the same mounted reset form while Router removes a legacy root token.
  // No AppShell links or auth redirects may render with the sensitive query.
  if (
    location.pathname === '/reset-password' ||
    new URLSearchParams(location.search).has(resetTokenParameter)
  )
    return <ResetPasswordPage />;
  if (
    location.pathname === '/activate-link' ||
    new URLSearchParams(location.search).has('verify_email_token')
  )
    return <ActivationLinkPage />;
  if (
    new URLSearchParams(location.search).has('checkout') &&
    !['/account', '/login', '/register', '/activate', '/forgot-password', '/terms'].includes(
      location.pathname,
    )
  )
    return (
      <Navigate
        replace
        to={{ pathname: '/account', search: location.search, hash: location.hash }}
      />
    );
  // A page change must unmount local credentials even while the next chunk loads.
  // Feature providers stay mounted above these pathname-keyed boundaries.
  return (
    <Routes>
      <Route
        path="login"
        element={
          <ViewBoundary key={location.pathname} resetKey={location.pathname}>
            <LoginPage />
          </ViewBoundary>
        }
      />
      <Route
        path="register"
        element={
          <ViewBoundary key={location.pathname} resetKey={location.pathname}>
            <RegistrationPage />
          </ViewBoundary>
        }
      />
      <Route
        path="activate"
        element={
          <ViewBoundary key={location.pathname} resetKey={location.pathname}>
            <ActivationPage />
          </ViewBoundary>
        }
      />
      <Route
        path="forgot-password"
        element={
          <ViewBoundary key={location.pathname} resetKey={location.pathname}>
            <ForgotPasswordPage />
          </ViewBoundary>
        }
      />
      <Route element={<AppShell session={session} />}>
        <Route index element={<LegacyEntryRedirect />} />
        <Route path="index.html" element={<LegacyEntryRedirect />} />
        <Route path="chat.html" element={<LegacyEntryRedirect />} />
        <Route
          path="feedback"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {feedbackElement ?? <FeedbackPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route path="terms" element={<TermsPage />} />
        <Route
          path="account"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {accountElement ?? <AccountPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route
          path="journal"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {journalElement ?? <JournalPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route
          path="map"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {mapElement ?? <MapPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route
          path="reflection"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {reflectionElement ?? <ReflectionPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route
          path="chat"
          element={
            <RequireSession>
              <ViewBoundary key={location.pathname} resetKey={location.pathname}>
                {chatElement ?? <ChatPage />}
              </ViewBoundary>
            </RequireSession>
          }
        />
        <Route path="agb.html" element={<TermsAlias />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
