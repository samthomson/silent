import { Component, ErrorInfo, ReactNode } from 'react';
import { APP_NAME } from '@/lib/constants';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}



export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Purple Screen of Death (Nostr Edition)
      return (
        <div className="min-h-screen bg-[#5B21B6] text-white p-8 font-['Lucida_Console','Consolas','Courier_New','monospace'] overflow-auto">
          <div className="max-w-4xl">
            {/* Main error message */}
            <h1 className="text-2xl mb-6 font-bold">
              A problem has been detected and {APP_NAME} needs to restart.
            </h1>
            
            <div className="space-y-4 text-sm leading-relaxed">
              <div className="mt-4">
                <div className="bg-black/30 p-4 border border-white/20">
                  <p className="mb-2 font-bold">{this.state.error?.name || 'Error'}</p>
                  <p>{this.state.error?.message || 'No error message available'}</p>
                </div>
              </div>

              {this.state.error?.stack && (
                <details className="mt-6" open>
                  <summary className="text-xs cursor-pointer hover:text-white/80">Stack trace</summary>
                  <pre className="mt-2 bg-black/30 p-2 overflow-auto max-h-48 text-[9px] leading-tight border border-white/20">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}

              <div className="mt-12 flex gap-4">
                <button
                  onClick={this.handleReset}
                  className="px-6 py-2 bg-white text-[#5B21B6] font-bold hover:bg-gray-200 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-black/40 border border-white hover:bg-black/60 transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}