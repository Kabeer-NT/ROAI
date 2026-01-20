import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks'
import { AuthPage, ChatPage, ConversationsPage } from './pages'

// Import styles
import './styles/base.css'
import './styles/components.css'
import './styles/features.css'
// import './styles/conversations.css'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <div className="loading-screen">Loading...</div>
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Auth */}
      <Route
        path="/auth"
        element={user ? <Navigate to="/conversations" replace /> : <AuthPage />}
      />

      {/* Conversations List (Landing Page) */}
      <Route
        path="/conversations"
        element={
          <ProtectedRoute>
            <ConversationsPage />
          </ProtectedRoute>
        }
      />

      {/* Chat with specific conversation */}
      <Route
        path="/chat/:conversationId"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />

      {/* Redirect root to conversations */}
      <Route path="/" element={<Navigate to="/conversations" replace />} />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/conversations" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}