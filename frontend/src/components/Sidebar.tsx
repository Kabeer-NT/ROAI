import { LogOut, User } from 'lucide-react'
import type { SpreadsheetFile, ConnectionStatus } from '../types'
import { FileCard } from './FileCard'
import { DropZone } from './DropZone'
import { useAuth } from '../hooks'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  status: ConnectionStatus
  models: string[]
  selectedModel: string
  onModelChange: (model: string) => void
  files: SpreadsheetFile[]
  onFileRemove: (id: string) => void
  onFilesAdd: (files: FileList) => void
  isUploading: boolean
}

export function Sidebar({
  isOpen,
  onToggle,
  status,
  models,
  selectedModel,
  onModelChange,
  files,
  onFileRemove,
  onFilesAdd,
  isUploading,
}: SidebarProps) {
  const { user, logout } = useAuth()

  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          {isOpen && <span className="logo-text">R-O-AI</span>}
        </div>
        <button className="sidebar-toggle" onClick={onToggle}>
          {isOpen ? '‹' : '›'}
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
            <div className="section-label">Connection</div>
            <div className={`connection-status ${status}`}>
              <span className="status-dot" />
              <span>
                {status === 'connected' && 'Ollama Connected'}
                {status === 'error' && 'Disconnected'}
                {status === 'checking' && 'Checking...'}
              </span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-label">Model</div>
            <select
              value={selectedModel}
              onChange={e => onModelChange(e.target.value)}
              className="model-dropdown"
              disabled={models.length === 0}
            >
              {models.length === 0 ? (
                <option>No models</option>
              ) : (
                models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))
              )}
            </select>
          </div>

          <div className="sidebar-section">
            <div className="section-label">
              Data Sources
              {files.length > 0 && <span className="count">{files.length}</span>}
            </div>
            <DropZone onFilesAdd={onFilesAdd} isUploading={isUploading} />
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
