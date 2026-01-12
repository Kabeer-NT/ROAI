import { useState } from 'react'
import { FileSpreadsheet, Eye } from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import { StructureViewer } from './StructureViewer'

interface FileCardProps {
  file: SpreadsheetFile
  onRemove: () => void
}

export function FileCard({ file, onRemove }: FileCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showStructure, setShowStructure] = useState(false)

  const totalRows = file.sheets.reduce((sum, s) => sum + s.rows, 0)

  return (
    <>
      <div className="file-card">
        <div className="file-card-header" onClick={() => setExpanded(!expanded)}>
          <FileSpreadsheet className="file-icon" size={20} color="#22c55e" />
          <div className="file-info">
            <div className="file-name" title={file.filename}>
              {file.filename}
            </div>
            <div className="file-meta">
              {file.sheets.length} sheet{file.sheets.length !== 1 ? 's' : ''} · {totalRows} rows
            </div>
          </div>
          <button
            className="file-remove"
            onClick={e => {
              e.stopPropagation()
              onRemove()
            }}
          >
            ×
          </button>
        </div>

        {expanded && (
          <div className="file-card-sheets">
            {file.sheets.map(sheet => (
              <div key={sheet.name} className="sheet-item">
                <span className="sheet-name">{sheet.name}</span>
                <span className="sheet-meta">{sheet.rows}×{sheet.columns}</span>
              </div>
            ))}
            <button 
              className="view-structure-btn"
              onClick={(e) => {
                e.stopPropagation()
                setShowStructure(true)
              }}
            >
              <Eye size={14} />
              View Structure (what AI sees)
            </button>
          </div>
        )}
      </div>
      
      <StructureViewer
        fileId={file.id}
        filename={file.filename}
        isOpen={showStructure}
        onClose={() => setShowStructure(false)}
      />
    </>
  )
}