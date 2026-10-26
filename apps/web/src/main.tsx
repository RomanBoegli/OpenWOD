import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './global.css';

/** A render error shows its message instead of an empty dark page, so it can be read and reported from a phone. */
class RootBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ padding: '24px 16px', color: 'var(--ink)', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '1.25rem' }}>OpenWOD hit an error</h1>
        <p style={{ color: 'var(--error-text)', wordBreak: 'break-word' }}>{String(this.state.error)}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--accent-fill)', color: 'var(--accent-ink)' }}>Reload</button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')!).render(<RootBoundary><App /></RootBoundary>);
