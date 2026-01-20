import { useState, useEffect, useRef } from 'react'
import { 
  LogOut, 
  User, 
  RefreshCw, 
  Hexagon, 
  ChevronLeft, 
  ChevronRight, 
  Sun, 
  Moon, 
  EyeOff, 
  FileSpreadsheet, 
  Settings,
  Plus,
  MessageSquare,
  MoreHorizontal,
  Edit2,
  Trash2,
  Check,
  X,
  Search
} from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import type { FileVisibilityState } from '../hooks/useVisibility'
import type { ConversationSummary } from '../hooks/useConversations'
import { FileCard } from './FileCard'
import { DropZone } from './DropZone'
import { useAuth } from '../hooks'

// ============================================================================
// Types
// ============================================================================

interface VisibilityStats {
  filesWithHidden: number
  totalHiddenItems: number
}

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  theme?: 'light' | 'dark'
  onThemeToggle?: () => void
  onSettingsClick?: () => void
  
  // Conversations
  conversations: ConversationSummary[]
  activeConversationId: number | null
  onConversationSelect: (id: number) => void
  onConversationNew: () => void
  onConversationDelete: (id: number) => void
  onConversationRename: (id: number, title: string) => void
  isLoadingConversations?: boolean
  
  // Files (shown when in a conversation)
  files?: SpreadsheetFile[]
  onFileRemove?: (id: string) => void
  onFilesAdd?: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  isUploading?: boolean
  isReloading?: boolean
  getFileVisibility?: (filename: string) => FileVisibilityState
  setFileVisibility?: (filename: string, visibility: FileVisibilityState) => void
  visibilityStats?: VisibilityStats
}

// ============================================================================
// Conversation Item Component
// ============================================================================

interface ConversationItemProps {
  conversation: ConversationSummary
  isActive: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}

function ConversationItem({ 
  conversation, 
  isActive, 
  onSelect, 
  onRename, 
  onDelete 
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

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

  const handleSave = () => {
    if (editTitle.trim() && editTitle.trim() !== conversation.title) {
      onRename(editTitle.trim())
    }
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditTitle(conversation.title)
    setIsEditing(false)
  }

  const handleDelete = () => {
    if (confirm('Delete this conversation? This cannot be undone.')) {
      onDelete()
    }
    setShowMenu(false)
  }

  if (isEditing) {
    return (
      <div className="conv-item editing">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
          autoFocus
          className="conv-edit-input"
        />
        <div className="conv-edit-actions">
          <button onClick={handleSave} className="conv-edit-btn save">
            <Check size={14} />
          </button>
          <button onClick={handleCancel} className="conv-edit-btn cancel">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div 
      className={`conv-item ${isActive ? 'active' : ''}`}
      onClick={onSelect}
    >
      <MessageSquare size={16} className="conv-icon" />
      <div className="conv-content">
        <div className="conv-title">{conversation.title}</div>
        <div className="conv-meta">
          <span className="conv-date">{formatDate(conversation.updated_at)}</span>
          {conversation.file_count > 0 && (
            <span className="conv-files">
              <FileSpreadsheet size={10} />
              {conversation.file_count}
            </span>
          )}
        </div>
      </div>
      
      <div className="conv-actions" ref={menuRef}>
        <button
          className="conv-menu-btn"
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        
        {showMenu && (
          <div className="conv-menu">
            <button onClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
              setShowMenu(false)
            }}>
              <Edit2 size={12} />
              Rename
            </button>
            <button onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }} className="danger">
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Main Sidebar Component
// ============================================================================

export function Sidebar({
  isOpen,
  onToggle,
  theme = 'dark',
  onThemeToggle,
  onSettingsClick,
  conversations,
  activeConversationId,
  onConversationSelect,
  onConversationNew,
  onConversationDelete,
  onConversationRename,
  isLoadingConversations = false,
  files = [],
  onFileRemove,
  onFilesAdd,
  onFilePickerOpen,
  isUploading = false,
  isReloading = false,
  getFileVisibility,
  setFileVisibility,
  visibilityStats,
}: SidebarProps) {
  const { user, logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  
  const isUsingNewSystem = !!getFileVisibility && !!setFileVisibility
  const hasActiveConversation = activeConversationId !== null
  
  // Filter conversations by search
  const filteredConversations = searchQuery.trim()
    ? conversations.filter(c => 
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations

  // Group conversations by date
  const groupedConversations = groupConversationsByDate(filteredConversations)
  
  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      {/* Header */}
      <div className="sidebar-header">
        {isOpen && (
          <div className="logo">
            <Hexagon className="logo-icon" size={24} />
            <span className="logo-text">R-O-AI</span>
          </div>
        )}
        <button className="sidebar-toggle" onClick={onToggle}>
          {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Collapsed: Icon rail */}
      {!isOpen && (
        <div className="sidebar-rail">
          <button 
            className="rail-btn rail-new" 
            onClick={onConversationNew}
            title="New conversation"
          >
            <Plus size={20} />
          </button>
          
          {onSettingsClick && (
            <button className="rail-btn" onClick={onSettingsClick} title="Settings">
              <Settings size={20} />
            </button>
          )}
          
          {onThemeToggle && (
            <button className="rail-btn" onClick={onThemeToggle} title={`${theme === 'dark' ? 'Dark' : 'Light'} Mode`}>
              {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          )}

          <div className="rail-spacer" />
          
          <button className="rail-btn" title={user?.full_name || 'User'}>
            <User size={20} />
          </button>
        </div>
      )}

      {/* Expanded Content */}
      {isOpen && (
        <div className="sidebar-content">
          {/* New Conversation Button */}
          <div className="sidebar-section">
            <button className="new-chat-btn" onClick={onConversationNew}>
              <Plus size={18} />
              <span>New conversation</span>
            </button>
          </div>

          {/* Search */}
          {conversations.length > 5 && (
            <div className="sidebar-section search-section">
              <div className="search-input-wrapper">
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                {searchQuery && (
                  <button 
                    className="search-clear"
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Conversations List */}
          <div className="sidebar-section conversations-section">
            {isLoadingConversations ? (
              <div className="conv-loading">
                <RefreshCw size={16} className="spinning" />
                <span>Loading...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="conv-empty">
                {searchQuery ? (
                  <>
                    <Search size={20} className="empty-icon" />
                    <p>No results for "{searchQuery}"</p>
                  </>
                ) : (
                  <>
                    <MessageSquare size={20} className="empty-icon" />
                    <p>No conversations yet</p>
                    <p className="empty-hint">Start a new conversation</p>
                  </>
                )}
              </div>
            ) : (
              <div className="conv-list">
                {Object.entries(groupedConversations).map(([group, convs]) => (
                  <div key={group} className="conv-group">
                    <div className="conv-group-label">{group}</div>
                    {convs.map(conv => (
                      <ConversationItem
                        key={conv.id}
                        conversation={conv}
                        isActive={conv.id === activeConversationId}
                        onSelect={() => onConversationSelect(conv.id)}
                        onRename={(title) => onConversationRename(conv.id, title)}
                        onDelete={() => onConversationDelete(conv.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Files Section (when in a conversation) */}
          {hasActiveConversation && onFilesAdd && (
            <div className="sidebar-section files-section">
              <div className="section-label">
                Files
                {files.length > 0 && <span className="count">{files.length}</span>}
                {isReloading && (
                  <RefreshCw size={12} className="reloading-icon spinning" />
                )}
              </div>
              
              <DropZone 
                onFilesAdd={onFilesAdd} 
                onFilePickerOpen={onFilePickerOpen}
                isUploading={isUploading} 
              />

              {visibilityStats && visibilityStats.totalHiddenItems > 0 && (
                <div className="visibility-indicator">
                  <EyeOff size={14} />
                  <span>{visibilityStats.totalHiddenItems} hidden</span>
                </div>
              )}
              
              {files.length > 0 && (
                <div className="files-list">
                  {files.map(file => (
                    <FileCard
                      key={file.id}
                      file={file}
                      onRemove={() => onFileRemove?.(file.id)}
                      fileVisibility={isUsingNewSystem ? getFileVisibility!(file.filename) : undefined}
                      onFileVisibilityChange={isUsingNewSystem 
                        ? (v) => setFileVisibility!(file.filename, v) 
                        : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="sidebar-footer">
            <div className="user-section">
              <div className="user-avatar">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="user-info">
                <div className="user-name">{user?.full_name || 'User'}</div>
              </div>
              <div className="user-actions">
                {onThemeToggle && (
                  <button className="footer-btn" onClick={onThemeToggle} title="Toggle theme">
                    {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </button>
                )}
                {onSettingsClick && (
                  <button className="footer-btn" onClick={onSettingsClick} title="Settings">
                    <Settings size={16} />
                  </button>
                )}
                <button className="footer-btn" onClick={logout} title="Sign out">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

// ============================================================================
// Helpers
// ============================================================================

function groupConversationsByDate(conversations: ConversationSummary[]): Record<string, ConversationSummary[]> {
  const groups: Record<string, ConversationSummary[]> = {}
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const conv of conversations) {
    const date = new Date(conv.updated_at)
    let group: string

    if (date >= today) {
      group = 'Today'
    } else if (date >= yesterday) {
      group = 'Yesterday'
    } else if (date >= lastWeek) {
      group = 'Previous 7 days'
    } else if (date >= lastMonth) {
      group = 'Previous 30 days'
    } else {
      group = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }

    if (!groups[group]) {
      groups[group] = []
    }
    groups[group].push(conv)
  }

  return groups
}