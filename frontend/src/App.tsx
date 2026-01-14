import { AuthProvider, useAuth } from './hooks'
import { ChatPage } from './pages/ChatPage'
import { AuthPage } from './pages/AuthPage'
import { Hexagon, Loader2 } from 'lucide-react'
// import './styles/global.css'
import './styles/base.css';
import './styles/components.css';
import './styles/features.css';

function AppContent() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">
          <Hexagon className="logo-icon spinning" size={32} />
          <span className="loading-text">Loading...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <AuthPage />
  }

  return <ChatPage />
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App