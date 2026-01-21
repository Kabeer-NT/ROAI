import { useState, useEffect, useRef } from 'react'
import { 
  LogOut, 
  RefreshCw, 
  Hexagon, 
  ChevronLeft, 
  ChevronRight,
  ChevronRight as ChevronExpand,
  Sun, 
  Moon, 
  Settings,
  Plus,
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
  
  // Files
  files?: SpreadsheetFile[]
  onFileRemove?: (id: string) => void
  onFilesAdd?: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  onViewStructure?: (fileId: string) => void
  isUploading?: boolean
  isReloading?: boolean
  getFileVisibility?: (filename: string) => FileVisibilityState
  setFileVisibility?: (filename: string, visibility: FileVisibilityState) => void
  visibilityStats?: VisibilityStats
}

// ============================================================================
// File Item - Click to View Structure
// ============================================================================

interface FileItemProps {
  file: SpreadsheetFile
  onRemove: () => void
  onViewStructure?: (fileId: string) => void
}

function FileItem({ file, onRemove, onViewStructure }: FileItemProps) {
  const ext = file.filename.split('.').pop()?.toLowerCase() || ''
  const isExcel = ['xlsx', 'xls'].includes(ext)
  
  const sheetCount = file.sheets?.length || 0
  const totalRows = file.sheets?.reduce((sum, s) => sum + s.rows, 0) || 0

  return (
    <div 
      className="sb-file"
      onClick={() => onViewStructure?.(file.id)}
    >
      <div className={`sb-file-icon ${isExcel ? 'sb-file-icon--xlsx' : 'sb-file-icon--csv'}`}>
        {isExcel ? '📊' : '📄'}
      </div>
      <div className="sb-file-info">
        <div className="sb-file-name">{file.filename}</div>
        <div className="sb-file-meta">
          {sheetCount > 0 
            ? `${sheetCount} sheet${sheetCount > 1 ? 's' : ''} · ${totalRows} rows`
            : ext.toUpperCase()
          }
        </div>
      </div>
      <button 
        className="sb-file-remove" 
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }} 
        title="Remove file"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ============================================================================
// Files Card (Dropdown)
// ============================================================================

interface FilesCardProps {
  files: SpreadsheetFile[]
  onFileRemove: (id: string) => void
  onFilesAdd: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  onViewStructure?: (fileId: string) => void
  isUploading: boolean
  isReloading: boolean
}

function FilesCard({ 
  files, 
  onFileRemove, 
  onFilesAdd, 
  onFilePickerOpen,
  onViewStructure,
  isUploading,
  isReloading 
}: FilesCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleAddClick = async () => {
    if (onFilePickerOpen) {
      const handled = await onFilePickerOpen()
      if (handled) return
    }
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdd(e.target.files)
      e.target.value = ''
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesAdd(e.dataTransfer.files)
    }
  }

  return (
    <div 
      className={`sb-files-card ${isDragging ? 'sb-files-card--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {files.length > 0 ? (
        <>
          {files.map(file => (
            <FileItem
              key={file.id}
              file={file}
              onRemove={() => onFileRemove(file.id)}
              onViewStructure={onViewStructure}
            />
          ))}
        </>
      ) : (
        <div className="sb-files-empty">No files yet</div>
      )}
      
      <button 
        className={`sb-add-file ${isUploading ? 'sb-add-file--uploading' : ''}`}
        onClick={handleAddClick}
        disabled={isUploading}
      >
        {isUploading ? (
          <>
            <RefreshCw size={12} className="sb-spinning" />
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <Plus size={12} />
            <span>Add file</span>
          </>
        )}
      </button>
      
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      
      {isReloading && (
        <div className="sb-files-reloading">
          <RefreshCw size={10} className="sb-spinning" />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Conversation Item
// ============================================================================

interface ConversationItemProps {
  conversation: ConversationSummary
  isActive: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
  onRename: (title: string) => void
  onDelete: () => void
  files: SpreadsheetFile[]
  onFileRemove: (id: string) => void
  onFilesAdd: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  onViewStructure?: (fileId: string) => void
  isUploading: boolean
  isReloading: boolean
}

function ConversationItem({ 
  conversation, 
  isActive,
  isExpanded,
  onSelect, 
  onToggleExpand,
  onRename, 
  onDelete,
  files,
  onFileRemove,
  onFilesAdd,
  onFilePickerOpen,
  onViewStructure,
  isUploading,
  isReloading
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const handleItemClick = () => {
    if (isActive) {
      onToggleExpand()
    } else {
      onSelect()
    }
  }

  if (isEditing) {
    return (
      <div className="sb-item sb-item--editing">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
          autoFocus
          className="sb-edit-input"
        />
        <div className="sb-edit-actions">
          <button onClick={handleSave} className="sb-edit-btn sb-edit-btn--save">
            <Check size={14} />
          </button>
          <button onClick={handleCancel} className="sb-edit-btn sb-edit-btn--cancel">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div 
        className={`sb-item ${isActive ? 'sb-item--active' : ''} ${isExpanded ? 'sb-item--expanded' : ''}`}
        onClick={handleItemClick}
      >
        <span className="sb-item-dot" />
        <span className="sb-item-title">{conversation.title}</span>
        
        {conversation.file_count > 0 && (
          <span className="sb-item-badge">{conversation.file_count}</span>
        )}
        
        <ChevronExpand size={14} className="sb-item-chevron" />
        
        <div className="sb-item-actions" ref={menuRef}>
          <button
            className="sb-item-menu-btn"
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          
          {showMenu && (
            <div className="sb-menu">
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
              }} className="sb-menu-danger">
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      
      {isActive && isExpanded && (
        <FilesCard
          files={files}
          onFileRemove={onFileRemove}
          onFilesAdd={onFilesAdd}
          onFilePickerOpen={onFilePickerOpen}
          onViewStructure={onViewStructure}
          isUploading={isUploading}
          isReloading={isReloading}
        />
      )}
    </>
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
  onViewStructure,
  isUploading = false,
  isReloading = false,
}: SidebarProps) {
  const { user, logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  
  // Auto-expand active conversation
  useEffect(() => {
    if (activeConversationId !== null) {
      setExpandedId(activeConversationId)
    }
  }, [activeConversationId])
  
  // Filter conversations by search
  const filteredConversations = searchQuery.trim()
    ? conversations.filter(c => 
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations

  // Group conversations by date
  const groupedConversations = groupConversationsByDate(filteredConversations)
  
  const handleToggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id)
  }
  
  return (
    <aside className={`sb ${isOpen ? 'sb--open' : 'sb--closed'}`}>
      {/* Header */}
      <div className="sb-header">
        {isOpen && (
          <div className="sb-logo">
            <Hexagon className="sb-logo-icon" size={22} />
            <span className="sb-logo-text">R-O-AI</span>
          </div>
        )}
        <button className="sb-collapse" onClick={onToggle}>
          {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {/* Collapsed Rail */}
      {!isOpen && (
        <div className="sb-rail">
          <button 
            className="sb-rail-btn sb-rail-btn--new" 
            onClick={onConversationNew}
            title="New conversation"
          >
            <Plus size={20} />
          </button>
          
          <div className="sb-rail-spacer" />
          
          {onThemeToggle && (
            <button 
              className="sb-rail-btn" 
              onClick={onThemeToggle} 
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
          )}
          
          {onSettingsClick && (
            <button className="sb-rail-btn" onClick={onSettingsClick} title="Settings">
              <Settings size={18} />
            </button>
          )}
          
          <button 
            className="sb-rail-btn sb-rail-btn--user" 
            title={user?.full_name || 'User'}
          >
            {user?.full_name?.charAt(0) || 'U'}
          </button>
        </div>
      )}

      {/* Expanded Content */}
      {isOpen && (
        <div className="sb-content">
          {/* New Conversation */}
          <div className="sb-top">
            <button className="sb-new-btn" onClick={onConversationNew}>
              <Plus size={16} />
              <span>New conversation</span>
            </button>
          </div>

          <div className="sb-divider" />

          {/* Conversations List */}
          <div className="sb-list">
            {/* Search (only if many conversations) */}
            {conversations.length > 5 && (
              <div className="sb-search">
                <Search size={14} className="sb-search-icon" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="sb-search-input"
                />
                {searchQuery && (
                  <button className="sb-search-clear" onClick={() => setSearchQuery('')}>
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Conversations */}
            {isLoadingConversations ? (
              <div className="sb-empty">
                <RefreshCw size={16} className="sb-spinning" />
                <span>Loading...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="sb-empty">
                {searchQuery ? (
                  <span>No results for "{searchQuery}"</span>
                ) : (
                  <>
                    <span>No conversations yet</span>
                    <span className="sb-empty-hint">Start a new conversation</span>
                  </>
                )}
              </div>
            ) : (
              Object.entries(groupedConversations).map(([group, convs]) => (
                <div key={group} className="sb-group">
                  <div className="sb-group-label">{group}</div>
                  {convs.map(conv => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === activeConversationId}
                      isExpanded={conv.id === expandedId}
                      onSelect={() => onConversationSelect(conv.id)}
                      onToggleExpand={() => handleToggleExpand(conv.id)}
                      onRename={(title) => onConversationRename(conv.id, title)}
                      onDelete={() => onConversationDelete(conv.id)}
                      files={conv.id === activeConversationId ? files : []}
                      onFileRemove={(id) => onFileRemove?.(id)}
                      onFilesAdd={(f) => onFilesAdd?.(f)}
                      onFilePickerOpen={onFilePickerOpen}
                      onViewStructure={onViewStructure}
                      isUploading={isUploading}
                      isReloading={isReloading}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="sb-footer">
            <div className="sb-user">
              <div className="sb-user-avatar">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <span className="sb-user-name">{user?.full_name || 'User'}</span>
            </div>
            <div className="sb-footer-actions">
              {onThemeToggle && (
                <button className="sb-footer-btn" onClick={onThemeToggle} title="Toggle theme">
                  {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                </button>
              )}
              {onSettingsClick && (
                <button className="sb-footer-btn" onClick={onSettingsClick} title="Settings">
                  <Settings size={15} />
                </button>
              )}
              <button className="sb-footer-btn" onClick={logout} title="Sign out">
                <LogOut size={15} />
              </button>
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

  for (const conv of conversations) {
    const date = new Date(conv.updated_at)
    let group: string

    if (date >= today) {
      group = 'Today'
    } else if (date >= yesterday) {
      group = 'Yesterday'
    } else if (date >= lastWeek) {
      group = 'This Week'
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