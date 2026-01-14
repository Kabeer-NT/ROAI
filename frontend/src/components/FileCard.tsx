import { useState } from 'react'
import { FileSpreadsheet, Eye, EyeOff } from 'lucide-react'
import type { SpreadsheetFile } from '../types'
import type { FileVisibilityState, SheetVisibilityState } from '../hooks/useVisibility'
import { StructureViewer } from './StructureViewer'

interface FileCardProps {
  file: SpreadsheetFile
  onRemove: () => void
  // NEW: Sheet-scoped visibility
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  // DEPRECATED: Legacy props for backward compatibility
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
  const [expanded, setExpanded] = useState(false)
  const [showStructure, setShowStructure] = useState(false)

  const totalRows = file.sheets.reduce((sum, s) => sum + s.rows, 0)
  
  // Count hidden items - prefer new system, fall back to legacy
  const hiddenCount = fileVisibility 
    ? countFileHidden(fileVisibility) 
    : countLegacyHidden(legacyVisibility)

  return (
    <>
      <div className={`file-card ${hiddenCount > 0 ? 'has-hidden' : ''}`}>
        <div className="file-card-header" onClick={() => setExpanded(!expanded)}>
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
            {file.sheets.map(sheet => {
              // Count hidden items per sheet if using new system
              const sheetHidden = fileVisibility?.[sheet.name]
                ? (fileVisibility[sheet.name].hiddenColumns.size +
                   fileVisibility[sheet.name].hiddenRows.size +
                   fileVisibility[sheet.name].hiddenCells.size)
                : 0
              
              return (
                <div key={sheet.name} className="sheet-item">
                  <span className="sheet-name">{sheet.name}</span>
                  <span className="sheet-meta">
                    {sheet.rows}×{sheet.columns}
                    {sheetHidden > 0 && (
                      <span className="sheet-hidden-indicator" title={`${sheetHidden} items hidden`}>
                        <EyeOff size={10} />
                        {sheetHidden}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
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
        // Pass both new and legacy props - StructureViewer will use what's available
        fileVisibility={fileVisibility}
        onFileVisibilityChange={onFileVisibilityChange}
        visibility={legacyVisibility}
        onVisibilityChange={legacyOnVisibilityChange}
      />
    </>
  )
}