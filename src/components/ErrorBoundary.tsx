import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MAIN_CONTENT_ID } from "../lib/a11y";
import { BrandLogo } from "./BrandLogo";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKeys?: unknown[];
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

type ErrorFallbackProps = {
  onReload: () => void;
  onReset: () => void;
};

function ErrorFallback({ onReload, onReset }: ErrorFallbackProps) {
  return (
    <div className="auth-layout auth-layout--centered">
      <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>
        Skip to main content
      </a>
      <main className="auth-card error-boundary-card" id={MAIN_CONTENT_ID} role="alert" aria-live="assertive">
        <BrandLogo variant="auth" linkTo={null} />
        <p className="eyebrow">Unexpected error</p>
        <h1>Something went wrong</h1>
        <p className="muted small">
          An unexpected problem occurred while loading this page. Reload the page or return home and try again.
        </p>
        <div className="error-boundary-actions">
          <button type="button" className="auth-submit" onClick={onReload}>
            Reload page
          </button>
          <Link className="marketing-button secondary error-boundary-home-link" to="/" onClick={onReset}>
            Go to home
          </Link>
        </div>
        <p className="auth-footer">
          Need help?{" "}
          <Link to="/app/account" onClick={onReset}>
            Account &amp; support
          </Link>
        </p>
      </main>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (!this.state.hasError) return;

    const prevKeys = prevProps.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];
    const keysChanged =
      prevKeys.length !== nextKeys.length || prevKeys.some((key, index) => key !== nextKeys[index]);

    if (keysChanged) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReload={this.handleReload} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}
