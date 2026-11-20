import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('Pander ErrorBoundary:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <h2 style={{ color: 'var(--danger, #dc2626)' }}>Ocurrió un error inesperado</h2>
          <p style={{ color: 'var(--text-muted)' }}>{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--primary, #2563eb)', color: '#fff', cursor: 'pointer' }}>
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
