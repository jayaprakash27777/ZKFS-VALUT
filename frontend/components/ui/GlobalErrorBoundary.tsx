'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class GlobalErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white/[0.02] border border-red-500/20 rounded-3xl p-8 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-bold font-outfit mb-2">Something went wrong</h1>
            <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
              We encountered a critical error. Your data remains completely encrypted and secure.
            </p>
            
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center gap-2 rounded-xl"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Application
            </button>

            {process.env.NODE_ENV === 'development' && (
              <div className="mt-6 p-4 bg-black/40 rounded-xl text-left w-full overflow-auto text-xs text-red-400 border border-red-500/10">
                <code className="whitespace-pre-wrap font-mono">
                  {this.state.error?.message}
                </code>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
