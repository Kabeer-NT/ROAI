import { useState } from 'react'
import { 
  MessageSquare, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  MoreHorizontal,
  FileSpreadsheet
} from 'lucide-react'
import type { ConversationSummary } from '../hooks/useConversations'

interface ConversationListProps {
  conversations: ConversationSummary[]
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  onRename: (id: number, title: string) => void
  isLoading?: boolean
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  isLoading = false
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    } else if (days === 1) {
      return 'Yesterday'
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' })
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  }

  const handleStartEdit = (conv: ConversationSummary) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
    setMenuOpenId(null)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleDelete = (id: number) => {
    if (confirm('Delete this conversation? This cannot be undone.')) {
      onDelete(id)
    }
    setMenuOpenId(null)
  }

  return (
    <div className="conversation-list">
      {/* New Conversation Button */}
      <button 
        className="conversation-new-btn"
        onClick={onNew}
        disabled={isLoading}
      >
        <Plus size={16} />
        <span>New Conversation</span>
      </button>

      {/* Conversation Items */}
      <div className="conversation-items">
        {conversations.length === 0 ? (
          <div className="conversation-empty">
            <MessageSquare size={24} className="empty-icon" />
            <p>No conversations yet</p>
            <p className="empty-hint">Start a new conversation to begin</p>
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              className={`conversation-item ${activeId === conv.id ? 'active' : ''}`}
              onClick={() => editingId !== conv.id && onSelect(conv.id)}
            >
              {editingId === conv.id ? (
                // Edit mode
                <div className="conversation-edit">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit()
                      if (e.key === 'Escape') handleCancelEdit()
                    }}
                    autoFocus
                    className="conversation-edit-input"
                  />
                  <div className="conversation-edit-actions">
                    <button onClick={handleSaveEdit} className="edit-btn save">
                      <Check size={14} />
                    </button>
                    <button onClick={handleCancelEdit} className="edit-btn cancel">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                // Normal mode
                <>
                  <div className="conversation-icon">
                    <MessageSquare size={16} />
                  </div>
                  
                  <div className="conversation-info">
                    <div className="conversation-title" title={conv.title}>
                      {conv.title}
                    </div>
                    <div className="conversation-meta">
                      <span className="conversation-date">
                        {formatDate(conv.updated_at)}
                      </span>
                      {conv.file_count > 0 && (
                        <span className="conversation-files" title={`${conv.file_count} file(s)`}>
                          <FileSpreadsheet size={10} />
                          {conv.file_count}
                        </span>
                      )}
                      {conv.message_count > 0 && (
                        <span className="conversation-messages">
                          {conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Actions Menu */}
                  <div className="conversation-actions">
                    <button
                      className="conversation-menu-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpenId(menuOpenId === conv.id ? null : conv.id)
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    
                    {menuOpenId === conv.id && (
                      <div className="conversation-menu">
                        <button onClick={() => handleStartEdit(conv)}>
                          <Edit2 size={12} />
                          Rename
                        </button>
                        <button 
                          onClick={() => handleDelete(conv.id)}
                          className="danger"
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}