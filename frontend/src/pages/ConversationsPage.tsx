import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Hexagon,
  Plus,
  MessageSquare,
  FileSpreadsheet,
  Trash2,
  Edit2,
  Check,
  X,
  Search,
  LogOut,
  Sun,
  Moon,
  Loader2,
} from 'lucide-react'
import { useConversations } from '../hooks/useConversations'
import { useAuth, useTheme } from '../hooks'

export function ConversationsPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const {
    conversations,
    isLoading,
    createConversation,
    deleteConversation,
    updateConversation,
  } = useConversations()

  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Filter conversations by search
  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Group by date
  const groupedConversations = filteredConversations.reduce((acc, conv) => {
    const date = new Date(conv.updated_at)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    let group: string
    if (days === 0) {
      group = 'Today'
    } else if (days === 1) {
      group = 'Yesterday'
    } else if (days < 7) {
      group = 'This Week'
    } else if (days < 30) {
      group = 'This Month'
    } else {
      group = 'Older'
    }

    if (!acc[group]) acc[group] = []
    acc[group].push(conv)
    return acc
  }, {} as Record<string, typeof conversations>)

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older']

  const handleNewConversation = useCallback(async () => {
    setIsCreating(true)
    try {
      const conv = await createConversation('New Conversation')
      if (conv) {
        navigate(`/chat/${conv.id}`)
      }
    } finally {
      setIsCreating(false)
    }
  }, [createConversation, navigate])

  const handleSelectConversation = useCallback((id: number) => {
    navigate(`/chat/${id}`)
  }, [navigate])

  const handleDelete = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Delete this conversation? This cannot be undone.')) {
      await deleteConversation(id)
    }
  }, [deleteConversation])

  const handleStartEdit = useCallback((id: number, title: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(id)
    setEditTitle(title)
  }, [])

  const handleSaveEdit = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editingId && editTitle.trim()) {
      await updateConversation(editingId, { title: editTitle.trim() })
    }
    setEditingId(null)
    setEditTitle('')
  }, [editingId, editTitle, updateConversation])

  const handleCancelEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(null)
    setEditTitle('')
  }, [])

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="conversations-page" data-theme={theme}>
      {/* Header */}
      <header className="conversations-header">
        <div className="header-logo">
          <Hexagon size={28} className="logo-icon" />
          <span className="logo-text">R-O-AI</span>
        </div>

        <div className="header-actions">
          <button
            className="theme-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="user-menu">
            <span className="user-name">{user?.full_name || user?.email}</span>
            <button className="logout-btn" onClick={logout} title="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="conversations-main">
        <div className="conversations-container">
          {/* Title & New Button */}
          <div className="conversations-title-row">
            <h1>Conversations</h1>
            <button
              className="new-conversation-btn"
              onClick={handleNewConversation}
              disabled={isCreating}
            >
              {isCreating ? (
                <Loader2 size={18} className="spinning" />
              ) : (
                <Plus size={18} />
              )}
              <span>New Conversation</span>
            </button>
          </div>

          {/* Search */}
          <div className="conversations-search">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Conversations List */}
          {isLoading ? (
            <div className="conversations-loading">
              <Loader2 size={32} className="spinning" />
              <p>Loading conversations...</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="conversations-empty">
              <MessageSquare size={48} className="empty-icon" />
              <h2>No conversations yet</h2>
              <p>Start a new conversation to begin analyzing spreadsheets with AI</p>
              <button
                className="empty-new-btn"
                onClick={handleNewConversation}
                disabled={isCreating}
              >
                <Plus size={18} />
                <span>Start New Conversation</span>
              </button>
            </div>
          ) : (
            <div className="conversations-list">
              {groupOrder.map(group => {
                const convs = groupedConversations[group]
                if (!convs || convs.length === 0) return null

                return (
                  <div key={group} className="conversation-group">
                    <h3 className="group-title">{group}</h3>
                    <div className="group-items">
                      {convs.map(conv => (
                        <div
                          key={conv.id}
                          className="conversation-card"
                          onClick={() => handleSelectConversation(conv.id)}
                        >
                          {editingId === conv.id ? (
                            <div className="card-edit" onClick={e => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveEdit(e as any)
                                  if (e.key === 'Escape') handleCancelEdit(e as any)
                                }}
                                autoFocus
                              />
                              <button onClick={handleSaveEdit} className="edit-save">
                                <Check size={16} />
                              </button>
                              <button onClick={handleCancelEdit} className="edit-cancel">
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="card-icon">
                                <MessageSquare size={20} />
                              </div>

                              <div className="card-content">
                                <h4 className="card-title">{conv.title}</h4>
                                <div className="card-meta">
                                  <span className="card-time">{formatTime(conv.updated_at)}</span>
                                  {conv.file_count > 0 && (
                                    <span className="card-files">
                                      <FileSpreadsheet size={12} />
                                      {conv.file_count} file{conv.file_count !== 1 ? 's' : ''}
                                    </span>
                                  )}
                                  <span className="card-messages">
                                    {conv.message_count} message{conv.message_count !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              </div>

                              <div className="card-actions">
                                <button
                                  className="card-action-btn"
                                  onClick={(e) => handleStartEdit(conv.id, conv.title, e)}
                                  title="Rename"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  className="card-action-btn danger"
                                  onClick={(e) => handleDelete(conv.id, e)}
                                  title="Delete"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}