import AppRouter from './routes'
import ErrorBoundary from './components/ui/ErrorBoundary'
import './index.css'

function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  )
}

export default App