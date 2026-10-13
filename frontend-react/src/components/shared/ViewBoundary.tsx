import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey?: string;
  onClose?: () => void;
}

// Chunk-load failures stay recoverable without logging private feature state.
export default class ViewBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="empty-state" role="alert">
          <p>FeelY could not open this view. Please reload the page.</p>
          {this.props.onClose && (
            <button className="secondary-button" type="button" onClick={this.props.onClose}>
              Close
            </button>
          )}
          <button
            className="secondary-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      );
    }
    return (
      <Suspense
        fallback={
          <p className="empty-state" role="status">
            Loading...
          </p>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
