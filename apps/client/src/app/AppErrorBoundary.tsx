import "../shared-ui/arcade.css";

import { Component, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  crashed: boolean;
}

/** The last line of defence: a render error or a failed code fetch must not leave a blank page. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { crashed: true };
  }

  override render() {
    if (!this.state.crashed) return this.props.children;

    return (
      <main className="page-shell arcade-page-shell arcade-flow-page">
        <div className="arcade-flow-shell">
          <section className="arcade-flow is-error">
            <div className="arcade-flow-intro">
              <p className="arcade-flow-eyebrow">Something went wrong</p>
              <h1>The game hit a problem.</h1>
              <p>Reload the page to carry on.</p>
            </div>
            <div className="arcade-flow-card">
              <button
                type="button"
                className="arcade-primary"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
              <a className="arcade-secondary" href="/">
                Go to the home page
              </a>
            </div>
          </section>
        </div>
      </main>
    );
  }
}
