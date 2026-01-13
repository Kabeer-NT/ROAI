import { LogOut, User, RefreshCw, Hexagon, ChevronLeft, ChevronRight, Sun, Moon } from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import { FileCard } from './FileCard'
import { DropZone } from './DropZone'
import { ModelSelector } from './ModelSelector'
import { useAuth } from '../hooks'

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
}: SidebarProps) {
  const { user, logout } = useAuth()

  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <div className="logo">
          <Hexagon className="logo-icon" size={24} />
          {isOpen && <span className="logo-text">R-O-AI</span>}
        </div>
        <button className="sidebar-toggle" onClick={onToggle}>
          {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {isOpen && (
        <>
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
              Data Sources
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
              <div className="files-list">
                {files.map(file => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onRemove={() => onFileRemove(file.id)}
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