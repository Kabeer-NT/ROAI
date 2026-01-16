import { useState } from 'react'
import { Table, ChevronDown } from 'lucide-react'
import { StructureViewer, SelectionRange, FileVisibilityState } from './StructureViewer'
import type { SpreadsheetFile } from '../types'

// ============================================================================
// WorkspacePanel - Thin wrapper around StructureViewer for Work Mode
// ============================================================================

interface WorkspacePanelProps {
  file: SpreadsheetFile
  files: SpreadsheetFile[]
  onFileSelect: (fileId: string) => void
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  onAskAI?: (selection: SelectionRange) => void
}

export function WorkspacePanel({
  file,
  files,
  onFileSelect,
  fileVisibility,
  onFileVisibilityChange,
  onAskAI,
}: WorkspacePanelProps) {
  const [showFileDropdown, setShowFileDropdown] = useState(false)
  const hasMultipleFiles = files.length > 1

  return (
    <div className="workspace-container">
      {/* File Selector - only show if multiple files */}
      {hasMultipleFiles && (
        <div className="workspace-file-bar">
          <div className="file-selector">
            <button 
              className="file-selector-btn"
              onClick={() => setShowFileDropdown(!showFileDropdown)}
            >
              <Table size={16} className="file-icon" />
              <span className="file-name">{file.filename}</span>
              <ChevronDown size={14} className={`chevron ${showFileDropdown ? 'open' : ''}`} />
            </button>
            
            {showFileDropdown && (
              <div className="file-dropdown">
                {files.map(f => (
                  <button
                    key={f.id}
                    className={`file-option ${f.id === file.id ? 'active' : ''}`}
                    onClick={() => {
                      onFileSelect(f.id)
                      setShowFileDropdown(false)
                    }}
                  >
                    <Table size={14} />
                    <span>{f.filename}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* StructureViewer in inline mode */}
      <StructureViewer
        fileId={file.id}
        filename={file.filename}
        mode="inline"
        fileVisibility={fileVisibility}
        onFileVisibilityChange={onFileVisibilityChange}
        onAskAI={onAskAI}
      />
    </div>
  )
}

// Re-export types for convenience
export type { SelectionRange, FileVisibilityState } from './StructureViewer'