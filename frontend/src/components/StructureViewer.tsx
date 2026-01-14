import { useState, useEffect, useCallback } from 'react'
import { X, Table, Hash, Type, Calculator, Grid, Eye, EyeOff, Shield, RotateCcw } from 'lucide-react'
import { useAuth } from '../hooks'

// ============================================================================
// Types
// ============================================================================

interface SheetStructure {
  rows: number
  cols: number
  headers: Record<string, string>
  row_labels: Record<string, string>
  text_values?: Record<string, string>
  formulas: Record<string, string>
  cell_type_counts: Record<string, number>
  cell_types?: Record<string, string>
}

interface StructureData {
  file_id: string
  filename: string
  structures: Record<string, SheetStructure>
}

// Sheet-scoped visibility state
export interface SheetVisibilityState {
  hiddenColumns: Set<string>  // Column letters: "A", "B", "C"
  hiddenRows: Set<number>     // Row numbers: 1, 2, 3
  hiddenCells: Set<string>    // Individual cells: "A1", "B2"
}

// File visibility state - organized by sheet name
export interface FileVisibilityState {
  [sheetName: string]: SheetVisibilityState
}

interface StructureViewerProps {
  fileId: string
  filename: string
  isOpen: boolean
  onClose: () => void
  // NEW: Sheet-scoped visibility
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  // DEPRECATED: Legacy props for backward compatibility
  visibility?: SheetVisibilityState
  onVisibilityChange?: (visibility: SheetVisibilityState) => void
}

type ViewMode = 'summary' | 'grid'

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptySheetVisibility(): SheetVisibilityState {
  return {
    hiddenColumns: new Set(),
    hiddenRows: new Set(),
    hiddenCells: new Set(),
  }
}

function getColumnLetter(idx: number): string {
  let letter = ''
  let n = idx
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter
    n = Math.floor(n / 26) - 1
  }
  return letter
}

function isCellHidden(
  cellAddr: string,
  col: string,
  row: number,
  visibility: SheetVisibilityState
): boolean {
  if (visibility.hiddenCells.has(cellAddr)) return true
  if (visibility.hiddenColumns.has(col)) return true
  if (visibility.hiddenRows.has(row)) return true
  return false
}

function countSheetHidden(visibility: SheetVisibilityState): number {
  return visibility.hiddenColumns.size + visibility.hiddenRows.size + visibility.hiddenCells.size
}

function countFileHidden(fileVisibility: FileVisibilityState): number {
  let total = 0
  for (const sheetVis of Object.values(fileVisibility)) {
    total += countSheetHidden(sheetVis)
  }
  return total
}

// ============================================================================
// Main Component
// ============================================================================

export function StructureViewer({ 
  fileId, 
  filename, 
  isOpen, 
  onClose,
  // New sheet-scoped props
  fileVisibility: externalFileVisibility,
  onFileVisibilityChange,
  // Legacy props (backward compatibility)
  visibility: legacyVisibility,
  onVisibilityChange: legacyOnVisibilityChange,
}: StructureViewerProps) {
  const { token } = useAuth()
  const [structure, setStructure] = useState<StructureData | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  
  // Internal file visibility state
  const [internalFileVisibility, setInternalFileVisibility] = useState<FileVisibilityState>({})
  
  // Determine which visibility system to use
  const isUsingNewSystem = !!onFileVisibilityChange
  
  // Get file visibility (use external if provided, otherwise internal)
  const fileVisibility = externalFileVisibility ?? internalFileVisibility
  
  // Get current sheet visibility
  const currentSheetVisibility = activeSheet 
    ? (fileVisibility[activeSheet] ?? createEmptySheetVisibility())
    : (legacyVisibility ?? createEmptySheetVisibility())
  
  // Update visibility for current sheet
  const setCurrentSheetVisibility = useCallback((newVisibility: SheetVisibilityState) => {
    if (isUsingNewSystem && activeSheet) {
      // New system: update sheet within file visibility
      const newFileVisibility = { ...fileVisibility, [activeSheet]: newVisibility }
      if (onFileVisibilityChange) {
        onFileVisibilityChange(newFileVisibility)
      } else {
        setInternalFileVisibility(newFileVisibility)
      }
    } else if (legacyOnVisibilityChange) {
      // Legacy system: just update the flat visibility
      legacyOnVisibilityChange(newVisibility)
    } else {
      // Fallback to internal state
      if (activeSheet) {
        setInternalFileVisibility(prev => ({ ...prev, [activeSheet]: newVisibility }))
      }
    }
  }, [activeSheet, fileVisibility, isUsingNewSystem, onFileVisibilityChange, legacyOnVisibilityChange])

  // Fetch structure data
  useEffect(() => {
    if (isOpen && fileId && token) {
      setLoading(true)
      fetch(`/api/spreadsheet/${fileId}/structure?include_cells=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          setStructure(data)
          if (data.structures) {
            const sheetNames = Object.keys(data.structures)
            setActiveSheet(sheetNames[0] || '')
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [isOpen, fileId, token])

  // Handle escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  // Toggle handlers - these now work on current sheet
  const toggleColumn = useCallback((col: string) => {
    const newHiddenColumns = new Set(currentSheetVisibility.hiddenColumns)
    if (newHiddenColumns.has(col)) {
      newHiddenColumns.delete(col)
    } else {
      newHiddenColumns.add(col)
    }
    setCurrentSheetVisibility({
      ...currentSheetVisibility,
      hiddenColumns: newHiddenColumns,
    })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const toggleRow = useCallback((row: number) => {
    const newHiddenRows = new Set(currentSheetVisibility.hiddenRows)
    if (newHiddenRows.has(row)) {
      newHiddenRows.delete(row)
    } else {
      newHiddenRows.add(row)
    }
    setCurrentSheetVisibility({
      ...currentSheetVisibility,
      hiddenRows: newHiddenRows,
    })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const toggleCell = useCallback((cellAddr: string) => {
    const newHiddenCells = new Set(currentSheetVisibility.hiddenCells)
    if (newHiddenCells.has(cellAddr)) {
      newHiddenCells.delete(cellAddr)
    } else {
      newHiddenCells.add(cellAddr)
    }
    setCurrentSheetVisibility({
      ...currentSheetVisibility,
      hiddenCells: newHiddenCells,
    })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const resetSheetVisibility = useCallback(() => {
    setCurrentSheetVisibility(createEmptySheetVisibility())
  }, [setCurrentSheetVisibility])

  const resetAllVisibility = useCallback(() => {
    if (isUsingNewSystem) {
      if (onFileVisibilityChange) {
        onFileVisibilityChange({})
      } else {
        setInternalFileVisibility({})
      }
    } else if (legacyOnVisibilityChange) {
      legacyOnVisibilityChange(createEmptySheetVisibility())
    }
  }, [isUsingNewSystem, onFileVisibilityChange, legacyOnVisibilityChange])

  if (!isOpen) return null

  const currentSheet = structure?.structures?.[activeSheet]
  const currentSheetHiddenCount = countSheetHidden(currentSheetVisibility)
  const totalHiddenCount = isUsingNewSystem 
    ? countFileHidden(fileVisibility)
    : currentSheetHiddenCount

  return (
    <div className="structure-viewer-fullscreen">
      <div className="structure-viewer-header">
        <div className="structure-viewer-title">
          <Shield size={20} className="shield-icon" />
          <span>What AI Sees: {filename}</span>
        </div>
        
        <div className="structure-tabs-inline">
          {structure?.structures && Object.keys(structure.structures).map(sheetName => {
            const sheetHidden = isUsingNewSystem 
              ? countSheetHidden(fileVisibility[sheetName] ?? createEmptySheetVisibility())
              : 0
            return (
              <button
                key={sheetName}
                className={`structure-tab ${activeSheet === sheetName ? 'active' : ''}`}
                onClick={() => setActiveSheet(sheetName)}
              >
                <Table size={14} />
                {sheetName}
                {sheetHidden > 0 && (
                  <span className="sheet-hidden-badge" title={`${sheetHidden} items hidden`}>
                    <EyeOff size={10} />
                    {sheetHidden}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="structure-viewer-actions">
          {currentSheetHiddenCount > 0 && (
            <button 
              className="reset-visibility-btn"
              onClick={resetSheetVisibility}
              title="Reset hidden items in this sheet"
            >
              <RotateCcw size={14} />
              <span>Reset Sheet ({currentSheetHiddenCount})</span>
            </button>
          )}
          {isUsingNewSystem && totalHiddenCount > currentSheetHiddenCount && (
            <button 
              className="reset-visibility-btn reset-all"
              onClick={resetAllVisibility}
              title="Reset all hidden items in all sheets"
            >
              <RotateCcw size={14} />
              <span>Reset All ({totalHiddenCount})</span>
            </button>
          )}
          <div className="view-mode-toggle">
            <button 
              className={`mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <Grid size={16} />
            </button>
            <button 
              className={`mode-btn ${viewMode === 'summary' ? 'active' : ''}`}
              onClick={() => setViewMode('summary')}
              title="Summary view"
            >
              <Type size={16} />
            </button>
          </div>
          <button className="structure-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="structure-viewer-body">
        {loading ? (
          <div className="structure-loading">Loading structure...</div>
        ) : !currentSheet ? (
          <div className="structure-error">Could not load structure</div>
        ) : viewMode === 'grid' ? (
          <GridView 
            sheet={currentSheet} 
            sheetName={activeSheet}
            visibility={currentSheetVisibility}
            onToggleColumn={toggleColumn}
            onToggleRow={toggleRow}
            onToggleCell={toggleCell}
          />
        ) : (
          <SummaryView 
            sheet={currentSheet} 
            visibility={currentSheetVisibility}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Grid View Component
// ============================================================================

interface GridViewProps {
  sheet: SheetStructure
  sheetName: string
  visibility: SheetVisibilityState
  onToggleColumn: (col: string) => void
  onToggleRow: (row: number) => void
  onToggleCell: (cellAddr: string) => void
}

function GridView({ sheet, sheetName, visibility, onToggleColumn, onToggleRow, onToggleCell }: GridViewProps) {
  const maxDisplayRows = Math.min(sheet.rows, 100)
  const maxDisplayCols = Math.min(sheet.cols, 26)

  const getCellContent = (rowIdx: number, colIdx: number): { type: string; content: string } => {
    const col = getColumnLetter(colIdx)
    const cellAddr = `${col}${rowIdx + 1}`
    
    const cellType = sheet.cell_types?.[cellAddr] || 'empty'
    
    if (sheet.headers?.[cellAddr]) {
      return { type: 'header', content: sheet.headers[cellAddr] }
    }
    if (sheet.row_labels?.[cellAddr]) {
      return { type: 'label', content: sheet.row_labels[cellAddr] }
    }
    if (sheet.formulas?.[cellAddr]) {
      return { type: 'formula', content: sheet.formulas[cellAddr] }
    }
    if (sheet.text_values?.[cellAddr]) {
      return { type: 'text', content: sheet.text_values[cellAddr] }
    }
    
    return { type: cellType, content: '' }
  }

  const handleColumnClick = (e: React.MouseEvent, col: string) => {
    if (e.shiftKey) {
      onToggleColumn(col)
    }
  }

  const handleRowClick = (e: React.MouseEvent, row: number) => {
    if (e.shiftKey) {
      onToggleRow(row)
    }
  }

  const handleCellClick = (e: React.MouseEvent, cellAddr: string) => {
    if (e.shiftKey) {
      onToggleCell(cellAddr)
    }
  }

  return (
    <div className="grid-view-fullscreen">
      <div className="grid-instructions">
        <EyeOff size={14} />
        <span><strong>Shift+click</strong> on column headers, row numbers, or cells to hide them from AI</span>
        <span className="sheet-indicator">Sheet: <strong>{sheetName}</strong></span>
      </div>
      <div className="grid-scroll-container">
        <table className="structure-grid">
          <thead>
            <tr>
              <th className="corner-cell"></th>
              {Array.from({ length: maxDisplayCols }, (_, idx) => {
                const col = getColumnLetter(idx)
                const isHidden = visibility.hiddenColumns.has(col)
                return (
                  <th 
                    key={idx} 
                    className={`col-header clickable ${isHidden ? 'user-hidden' : ''}`}
                    onClick={(e) => handleColumnClick(e, col)}
                    title={isHidden ? `Shift+click to show column ${col}` : `Shift+click to hide column ${col}`}
                  >
                    <span className="col-letter">{col}</span>
                    {isHidden && <EyeOff size={10} className="hidden-indicator" />}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxDisplayRows }, (_, rowIdx) => {
              const rowNum = rowIdx + 1
              const isRowHidden = visibility.hiddenRows.has(rowNum)
              
              return (
                <tr key={rowIdx} className={isRowHidden ? 'row-hidden' : ''}>
                  <td 
                    className={`row-header clickable ${isRowHidden ? 'user-hidden' : ''}`}
                    onClick={(e) => handleRowClick(e, rowNum)}
                    title={isRowHidden ? `Shift+click to show row ${rowNum}` : `Shift+click to hide row ${rowNum}`}
                  >
                    <span className="row-number">{rowNum}</span>
                    {isRowHidden && <EyeOff size={10} className="hidden-indicator" />}
                  </td>
                  {Array.from({ length: maxDisplayCols }, (_, colIdx) => {
                    const col = getColumnLetter(colIdx)
                    const cellAddr = `${col}${rowNum}`
                    const { type, content } = getCellContent(rowIdx, colIdx)
                    const isCellUserHidden = isCellHidden(cellAddr, col, rowNum, visibility)
                    
                    return (
                      <td 
                        key={colIdx} 
                        className={`grid-cell ${type} ${isCellUserHidden ? 'user-hidden' : ''}`}
                        onClick={(e) => handleCellClick(e, cellAddr)}
                        title={
                          isCellUserHidden 
                            ? `${cellAddr}: Hidden from AI (Shift+click to show)` 
                            : `${cellAddr}${content ? `: ${content}` : ''} (Shift+click to hide)`
                        }
                      >
                        <div className="cell-content">
                          {isCellUserHidden ? (
                            <EyeOff size={10} className="hidden-icon user-hidden-icon" />
                          ) : type === 'numeric' ? (
                            <EyeOff size={10} className="hidden-icon" />
                          ) : type === 'formula' ? (
                            <span className="formula-indicator">ƒx</span>
                          ) : content ? (
                            <span className="cell-text">{content}</span>
                          ) : null}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-info">
        {sheet.rows} rows × {sheet.cols} columns
        {countSheetHidden(visibility) > 0 && (
          <span className="hidden-count">
            · {countSheetHidden(visibility)} items hidden from AI in this sheet
          </span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Summary View Component
// ============================================================================

interface SummaryViewProps {
  sheet: SheetStructure
  visibility: SheetVisibilityState
}

function SummaryView({ sheet, visibility }: SummaryViewProps) {
  const headersArray = Object.entries(sheet.headers || {}).sort((a, b) => {
    const colA = a[0].replace(/\d+/g, '')
    const colB = b[0].replace(/\d+/g, '')
    return colA.localeCompare(colB)
  })

  const rowLabelsArray = Object.entries(sheet.row_labels || {}).slice(0, 30)
  const hiddenCount = countSheetHidden(visibility)

  return (
    <div className="summary-view-fullscreen">
      <div className="summary-grid">
        <div className="summary-card">
          <h3><Hash size={16} /> Dimensions</h3>
          <div className="summary-stat">
            <span className="stat-value">{sheet.rows}</span>
            <span className="stat-label">rows</span>
          </div>
          <div className="summary-stat">
            <span className="stat-value">{sheet.cols}</span>
            <span className="stat-label">columns</span>
          </div>
        </div>

        {hiddenCount > 0 && (
          <div className="summary-card hidden-summary">
            <h3><EyeOff size={16} /> Hidden from AI (this sheet)</h3>
            {visibility.hiddenColumns.size > 0 && (
              <div className="hidden-item">
                <span className="hidden-label">Columns:</span>
                <span className="hidden-value">{[...visibility.hiddenColumns].sort().join(', ')}</span>
              </div>
            )}
            {visibility.hiddenRows.size > 0 && (
              <div className="hidden-item">
                <span className="hidden-label">Rows:</span>
                <span className="hidden-value">{[...visibility.hiddenRows].sort((a, b) => a - b).join(', ')}</span>
              </div>
            )}
            {visibility.hiddenCells.size > 0 && (
              <div className="hidden-item">
                <span className="hidden-label">Cells:</span>
                <span className="hidden-value">{[...visibility.hiddenCells].sort().join(', ')}</span>
              </div>
            )}
          </div>
        )}

        <div className="summary-card">
          <h3><Eye size={16} /> Cell Types</h3>
          {Object.entries(sheet.cell_type_counts || {}).map(([type, count]) => (
            <div key={type} className="cell-type-row">
              <span className={`cell-type-dot ${type}`} />
              <span className="cell-type-name">{type}</span>
              <span className="cell-type-count">{count}</span>
            </div>
          ))}
        </div>

        <div className="summary-card wide">
          <h3><Type size={16} /> Headers</h3>
          <div className="tags-container">
            {headersArray.length > 0 ? (
              headersArray.map(([cell, header]) => {
                const col = cell.replace(/\d+/g, '')
                const row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const isHidden = isCellHidden(cell, col, row, visibility)
                return (
                  <span 
                    key={cell} 
                    className={`structure-tag header-tag ${isHidden ? 'user-hidden' : ''}`}
                  >
                    <span className="tag-cell">{cell}</span>
                    {isHidden ? <EyeOff size={10} /> : header}
                  </span>
                )
              })
            ) : (
              <span className="no-data">No headers detected</span>
            )}
          </div>
        </div>

        {rowLabelsArray.length > 0 && (
          <div className="summary-card wide">
            <h3><Table size={16} /> Row Labels</h3>
            <div className="tags-container">
              {rowLabelsArray.map(([cell, label]) => {
                const col = cell.replace(/\d+/g, '')
                const row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const isHidden = isCellHidden(cell, col, row, visibility)
                return (
                  <span 
                    key={cell} 
                    className={`structure-tag row-tag ${isHidden ? 'user-hidden' : ''}`}
                  >
                    <span className="tag-cell">{cell}</span>
                    {isHidden ? <EyeOff size={10} /> : label}
                  </span>
                )
              })}
              {Object.keys(sheet.row_labels || {}).length > 30 && (
                <span className="structure-tag more-tag">
                  +{Object.keys(sheet.row_labels || {}).length - 30} more
                </span>
              )}
            </div>
          </div>
        )}

        {Object.keys(sheet.formulas || {}).length > 0 && (
          <div className="summary-card wide">
            <h3><Calculator size={16} /> Formulas</h3>
            <div className="formulas-list">
              {Object.entries(sheet.formulas).slice(0, 20).map(([cell, formula]) => {
                const col = cell.replace(/\d+/g, '')
                const row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const isHidden = isCellHidden(cell, col, row, visibility)
                return (
                  <div key={cell} className={`formula-row ${isHidden ? 'user-hidden' : ''}`}>
                    <span className="formula-cell">{cell}</span>
                    {isHidden ? (
                      <span className="formula-hidden"><EyeOff size={12} /> Hidden</span>
                    ) : (
                      <code className="formula-code">{formula}</code>
                    )}
                  </div>
                )
              })}
              {Object.keys(sheet.formulas).length > 20 && (
                <div className="formula-row more">
                  +{Object.keys(sheet.formulas).length - 20} more formulas
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}