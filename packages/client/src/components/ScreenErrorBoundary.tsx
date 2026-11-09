import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tSafe } from './ErrorBoundary';
import { recordError } from '../services/error-ledger';
import { useAuthStore } from '../stores/auth.store';
import { roleHomePath } from '../lib/role-home';

// PROFILE-RESCUE G3 (containment) — error boundary around the routed
// screen area, INSIDE the router context. One screen's render crash
// degrades that screen to a small in-place fallback while the shell
// (bottom nav, banners, toasts) and every other route stay alive:
// tapping any nav tab navigates away, and the boundary self-resets on
// the route change. The root ErrorBoundary in main.tsx remains the
// outer net for crashes outside the routed area.
//
// Mounted twice, deliberately:
//   - in AppShell around {children}: keeps the bottom nav usable when
//     an app screen crashes (the Kigali Profile case);
//   - in App around <Routes>: contains the shell-less screens (login,
//     onboarding, admin) with in-app recovery instead of the root
//     boundary's home-reset.

interface InnerProps {
  pathname: string;
  homePath: string;
  onNavigateHome: (homePath: string) => void;
  children: React.ReactNode;
}

interface InnerState {
  hasError: boolean;
}

class ScreenErrorBoundaryInner extends React.Component<InnerProps, InnerState> {
  override state: InnerState = { hasError: false };

  static getDerivedStateFromError(): InnerState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `[screen] uncaught render error on ${this.props.pathname}:`,
      error,
      info.componentStack,
    );
    // BLACKBOX G2 — observe only. The self-reset on navigation and both
    // recovery buttons behave exactly as they did before.
    recordError({ kind: 'screen-render', message: error?.message, stack: error?.stack });
  }

  override componentDidUpdate(prevProps: InnerProps): void {
    // Navigation heals: a route change means new screen, fresh start.
    if (this.state.hasError && prevProps.pathname !== this.props.pathname) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  handleGoHome = (): void => {
    this.props.onNavigateHome(this.props.homePath);
    // Same-route case (crash on the home screen itself): the pathname
    // won't change, so reset explicitly rather than waiting for
    // componentDidUpdate.
    this.setState({ hasError: false });
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center px-4 py-16 min-h-[60vh]"
        data-testid="screen-error-fallback"
      >
        <div className="text-center max-w-sm w-full">
          <p className="text-lg text-gray-600 mb-6">
            {tSafe('errors.screenCrashTitle', 'This screen hit a problem')}
          </p>
          <div className="flex flex-col gap-3 items-stretch">
            <button
              type="button"
              onClick={this.handleGoHome}
              className="inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-lg bg-[#1B4F72] text-white font-medium hover:bg-[#164060] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2"
              data-testid="screen-error-home"
            >
              {tSafe('errors.goHome', 'Go to home screen')}
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center min-h-[44px] px-6 py-2.5 rounded-lg bg-white border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#1B4F72] focus:ring-offset-2"
              data-testid="screen-error-retry"
            >
              {tSafe('errors.boundaryRetry', 'Retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export const ScreenErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  return (
    <ScreenErrorBoundaryInner
      pathname={location.pathname}
      homePath={roleHomePath(role)}
      onNavigateHome={(homePath) => navigate(homePath, { replace: true })}
    >
      {children}
    </ScreenErrorBoundaryInner>
  );
};

export default ScreenErrorBoundary;
