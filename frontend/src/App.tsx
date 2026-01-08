import { AuthProvider, useAuth } from './hooks'
import { ChatPage } from './pages/ChatPage'
import { AuthPage } from './pages/AuthPage'
import './styles/global.css'

function AppContent() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">
          <span className="logo-icon">◈</span>
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
