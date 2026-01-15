import { useState } from 'react'
import { FileSpreadsheet, Eye, EyeOff, X, Table, ChevronRight } from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import type { FileVisibilityState, SheetVisibilityState } from '../hooks/useVisibility'
import { StructureViewer } from './StructureViewer'

interface FileCardProps {
  file: SpreadsheetFile
  onRemove: () => void
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  visibility?: SheetVisibilityState
  onVisibilityChange?: (visibility: SheetVisibilityState) => void
}

function countFileHidden(fileVisibility?: FileVisibilityState): number {
  if (!fileVisibility) return 0
  let total = 0
  for (const sheetVis of Object.values(fileVisibility)) {
    total += sheetVis.hiddenColumns.size
    total += sheetVis.hiddenRows.size
    total += sheetVis.hiddenCells.size
  }
  return total
}

function countLegacyHidden(visibility?: SheetVisibilityState): number {
  if (!visibility) return 0
  return visibility.hiddenColumns.size + visibility.hiddenRows.size + visibility.hiddenCells.size
}

export function FileCard({ 
  file, 
  onRemove, 
  fileVisibility,
  onFileVisibilityChange,
  visibility: legacyVisibility, 
  onVisibilityChange: legacyOnVisibilityChange 
}: FileCardProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [showStructure, setShowStructure] = useState(false)

  const totalRows = file.sheets.reduce((sum, s) => sum + s.rows, 0)
  const totalCols = Math.max(...file.sheets.map(s => s.columns))
  
  const hiddenCount = fileVisibility 
    ? countFileHidden(fileVisibility) 
    : countLegacyHidden(legacyVisibility)

  return (
    <>
      {/* Compact File Card */}
      <div 
        className={`file-card ${hiddenCount > 0 ? 'has-hidden' : ''}`}
        onClick={() => setShowDetails(true)}
      >
        <div className="file-card-header">
          <FileSpreadsheet className="file-icon" size={20} color="#22c55e" />
          <div className="file-info">
            <div className="file-name" title={file.filename}>
              {file.filename}
            </div>
            <div className="file-meta">
              {file.sheets.length} sheet{file.sheets.length !== 1 ? 's' : ''} · {totalRows} rows
              {hiddenCount > 0 && (
                <span className="hidden-badge" title={`${hiddenCount} items hidden from AI`}>
                  <EyeOff size={10} />
                  {hiddenCount}
                </span>
              )}
            </div>
          </div>
          <ChevronRight size={16} className="file-card-chevron" />
        </div>
      </div>

      {/* File Details Popup */}
      {showDetails && (
        <div className="file-details-overlay" onClick={() => setShowDetails(false)}>
          <div className="file-details-popup" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="file-details-header">
              <div className="file-details-title">
                <FileSpreadsheet size={20} color="#22c55e" />
                <div>
                  <div className="file-details-name">{file.filename}</div>
                  <div className="file-details-meta">
                    {file.sheets.length} sheet{file.sheets.length !== 1 ? 's' : ''} · {totalRows} rows · {totalCols} columns
                  </div>
                </div>
              </div>
              <button className="file-details-close" onClick={() => setShowDetails(false)}>
                <X size={18} />
              </button>
            </div>

            {/* Sheets List */}
            <div className="file-details-sheets">
              <div className="file-details-section-label">Sheets</div>
              {file.sheets.map(sheet => {
                const sheetHidden = fileVisibility?.[sheet.name]
                  ? (fileVisibility[sheet.name].hiddenColumns.size +
                     fileVisibility[sheet.name].hiddenRows.size +
                     fileVisibility[sheet.name].hiddenCells.size)
                  : 0
                
                return (
                  <div key={sheet.name} className="file-details-sheet-item">
                    <Table size={14} className="sheet-icon" />
                    <span className="sheet-name">{sheet.name}</span>
                    <span className="sheet-dimensions">{sheet.rows} × {sheet.columns}</span>
                    {sheetHidden > 0 && (
                      <span className="sheet-hidden-badge">
                        <EyeOff size={10} />
                        {sheetHidden} hidden
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="file-details-actions">
              <button 
                className="file-details-btn view-btn"
                onClick={() => {
                  setShowDetails(false)
                  setShowStructure(true)
                }}
              >
                <Eye size={16} />
                View Structure
              </button>
              <button 
                className="file-details-btn remove-btn"
                onClick={() => {
                  setShowDetails(false)
                  onRemove()
                }}
              >
                <X size={16} />
                Remove File
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Structure Viewer Modal */}
      <StructureViewer
        fileId={file.id}
        filename={file.filename}
        isOpen={showStructure}
        onClose={() => setShowStructure(false)}
        fileVisibility={fileVisibility}
        onFileVisibilityChange={onFileVisibilityChange}
        visibility={legacyVisibility}
        onVisibilityChange={legacyOnVisibilityChange}
      />
    </>
  )
}