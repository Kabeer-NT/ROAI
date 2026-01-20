import { LogOut, User, RefreshCw, Hexagon, ChevronLeft, ChevronRight, Sun, Moon, EyeOff, FileSpreadsheet, ArrowLeft } from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import type { FileVisibilityState, SheetVisibilityState } from '../hooks/useVisibility'
import { FileCard } from './FileCard'
import { DropZone } from './DropZone'
import { ModelSelector } from './ModelSelector'
import { useAuth } from '../hooks'

interface VisibilityStats {
  filesWithHidden: number
  totalHiddenItems: number
}

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  models: string[]
  selectedModel: string
  onModelChange: (model: string) => void
  files: SpreadsheetFile[]
  onFileRemove: (id: string) => void
  onFilesAdd: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  isUploading: boolean
  isReloading?: boolean
  theme?: 'light' | 'dark'
  onThemeToggle?: () => void
  getFileVisibility?: (filename: string) => FileVisibilityState
  setFileVisibility?: (filename: string, visibility: FileVisibilityState) => void
  getVisibility?: (filename: string) => SheetVisibilityState
  setVisibility?: (filename: string, visibility: SheetVisibilityState) => void
  visibilityStats?: VisibilityStats
  // New: conversation context
  conversationTitle?: string
  onBackClick?: () => void
}

export function Sidebar({
  isOpen,
  onToggle,
  models,
  selectedModel,
  onModelChange,
  files,
  onFileRemove,
  onFilesAdd,
  onFilePickerOpen,
  isUploading,
  isReloading,
  theme = 'dark',
  onThemeToggle,
  getFileVisibility,
  setFileVisibility,
  getVisibility,
  setVisibility,
  visibilityStats,
  conversationTitle,
  onBackClick,
}: SidebarProps) {
  const { user, logout } = useAuth()
  
  const isUsingNewSystem = !!getFileVisibility && !!setFileVisibility
  
  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
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
          {onBackClick && (
            <button className="rail-btn rail-back" onClick={onBackClick} title="Back to conversations">
              <ArrowLeft size={20} />
            </button>
          )}
          
          <button className="rail-btn rail-user" title={user?.full_name || 'User'}>
            <User size={20} />
          </button>
          
          {onThemeToggle && (
            <button className="rail-btn rail-theme" onClick={onThemeToggle} title={`${theme === 'dark' ? 'Dark' : 'Light'} Mode`}>
              {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          )}
          
          <button className="rail-btn rail-files" onClick={onToggle} title={`${files.length} file${files.length !== 1 ? 's' : ''}`}>
            <FileSpreadsheet size={20} />
            {files.length > 0 && (
              <span className="rail-badge">{files.length > 9 ? '9+' : files.length}</span>
            )}
          </button>
        </div>
      )}

      {/* Expanded: Full sidebar content */}
      {isOpen && (
        <>
          {/* Back to conversations */}
          {onBackClick && (
            <div className="sidebar-section back-section">
              <button className="back-btn" onClick={onBackClick}>
                <ArrowLeft size={16} />
                <span>All Conversations</span>
              </button>
            </div>
          )}

          {/* Conversation title */}
          {conversationTitle && (
            <div className="sidebar-section conversation-section">
              <div className="conversation-title-display">
                {conversationTitle}
              </div>
            </div>
          )}

          <div className="sidebar-section user-section">
            <div className="user-info">
              <div className="user-avatar">
                <User size={18} />
              </div>
              <div className="user-details">
                <div className="user-name">{user?.full_name || 'User'}</div>
                <div className="user-email">{user?.email}</div>
              </div>
              <button className="logout-btn" onClick={logout} title="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-label">Model</div>
            <ModelSelector
              models={models}
              selectedModel={selectedModel}
              onModelChange={onModelChange}
            />
          </div>

          {onThemeToggle && (
            <div className="sidebar-section">
              <div className="section-label">Appearance</div>
              <button className="theme-toggle" onClick={onThemeToggle}>
                <span className="theme-toggle-label">
                  {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  <span>{theme === 'dark' ? 'Dark' : 'Light'} Mode</span>
                </span>
                <div className="theme-toggle-switch" />
              </button>
            </div>
          )}

          <div className="sidebar-section">
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
            {onFilePickerOpen && (
              <div className="drop-zone-note">
                Click to enable auto-reload on file changes
              </div>
            )}
          </div>

          {files.length > 0 && (
            <div className="sidebar-section files-section">
              {visibilityStats && visibilityStats.totalHiddenItems > 0 && (
                <div className="visibility-indicator">
                  <EyeOff size={14} />
                  <span>{visibilityStats.totalHiddenItems} items hidden from AI</span>
                </div>
              )}
              
              <div className="files-list">
                {files.map(file => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onRemove={() => onFileRemove(file.id)}
                    fileVisibility={isUsingNewSystem ? getFileVisibility!(file.filename) : undefined}
                    onFileVisibilityChange={isUsingNewSystem 
                      ? (v) => setFileVisibility!(file.filename, v) 
                      : undefined
                    }
                    visibility={!isUsingNewSystem && getVisibility ? getVisibility(file.filename) : undefined}
                    onVisibilityChange={!isUsingNewSystem && setVisibility 
                      ? (v) => setVisibility(file.filename, v) 
                      : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}