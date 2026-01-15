import { useState, useEffect, useCallback, useRef } from 'react'
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
  numeric_values?: Record<string, number>
  formulas: Record<string, string>
  cell_type_counts: Record<string, number>
  cell_types?: Record<string, string>
}

interface StructureData {
  file_id: string
  filename: string
  structures: Record<string, SheetStructure>
}

export interface SheetVisibilityState {
  hiddenColumns: Set<string>
  hiddenRows: Set<number>
  hiddenCells: Set<string>
  visibleColumns: Set<string>
  visibleRows: Set<number>
  visibleCells: Set<string>
}

export interface FileVisibilityState {
  [sheetName: string]: SheetVisibilityState
}

interface StructureViewerProps {
  fileId: string
  filename: string
  isOpen: boolean
  onClose: () => void
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  visibility?: SheetVisibilityState
  onVisibilityChange?: (visibility: SheetVisibilityState) => void
}

type ViewMode = 'summary' | 'grid'

// ============================================================================
// Helpers
// ============================================================================

function createEmptySheetVisibility(): SheetVisibilityState {
  return {
    hiddenColumns: new Set(),
    hiddenRows: new Set(),
    hiddenCells: new Set(),
    visibleColumns: new Set(),
    visibleRows: new Set(),
    visibleCells: new Set(),
  }
}

function ensureFields(vis: Partial<SheetVisibilityState>): SheetVisibilityState {
  return {
    hiddenColumns: vis.hiddenColumns ?? new Set(),
    hiddenRows: vis.hiddenRows ?? new Set(),
    hiddenCells: vis.hiddenCells ?? new Set(),
    visibleColumns: vis.visibleColumns ?? new Set(),
    visibleRows: vis.visibleRows ?? new Set(),
    visibleCells: vis.visibleCells ?? new Set(),
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

function isUserHidden(cellAddr: string, col: string, row: number, vis: SheetVisibilityState): boolean {
  return vis.hiddenCells?.has(cellAddr) || vis.hiddenColumns?.has(col) || vis.hiddenRows?.has(row)
}

function isWhitelisted(cellAddr: string, col: string, row: number, vis: SheetVisibilityState): boolean {
  return vis.visibleCells?.has(cellAddr) || vis.visibleColumns?.has(col) || vis.visibleRows?.has(row)
}

function countHidden(vis: SheetVisibilityState): number {
  return (vis.hiddenColumns?.size || 0) + (vis.hiddenRows?.size || 0) + (vis.hiddenCells?.size || 0)
}

function countVisible(vis: SheetVisibilityState): number {
  return (vis.visibleColumns?.size || 0) + (vis.visibleRows?.size || 0) + (vis.visibleCells?.size || 0)
}

function countFileHidden(fv: FileVisibilityState): number {
  return Object.values(fv).reduce((t, s) => t + countHidden(s), 0)
}

function countFileVisible(fv: FileVisibilityState): number {
  return Object.values(fv).reduce((t, s) => t + countVisible(s), 0)
}

// ============================================================================
// Main Component
// ============================================================================

export function StructureViewer({ 
  fileId, filename, isOpen, onClose,
  fileVisibility: externalFileVisibility,
  onFileVisibilityChange,
  visibility: legacyVisibility,
  onVisibilityChange: legacyOnVisibilityChange,
}: StructureViewerProps) {
  const { token } = useAuth()
  const [structure, setStructure] = useState<StructureData | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [internalFileVisibility, setInternalFileVisibility] = useState<FileVisibilityState>({})
  
  const isUsingNewSystem = !!onFileVisibilityChange
  const fileVisibility = externalFileVisibility ?? internalFileVisibility
  
  const currentSheetVisibility: SheetVisibilityState = activeSheet 
    ? ensureFields(fileVisibility[activeSheet] ?? {})
    : ensureFields(legacyVisibility ?? {})
  
  const setCurrentSheetVisibility = useCallback((newVis: SheetVisibilityState) => {
    if (isUsingNewSystem && activeSheet) {
      const newFileVis = { ...fileVisibility, [activeSheet]: newVis }
      onFileVisibilityChange ? onFileVisibilityChange(newFileVis) : setInternalFileVisibility(newFileVis)
    } else if (legacyOnVisibilityChange) {
      legacyOnVisibilityChange(newVis)
    } else if (activeSheet) {
      setInternalFileVisibility(prev => ({ ...prev, [activeSheet]: newVis }))
    }
  }, [activeSheet, fileVisibility, isUsingNewSystem, onFileVisibilityChange, legacyOnVisibilityChange])

  useEffect(() => {
    if (isOpen && fileId && token) {
      setLoading(true)
      fetch(`/api/spreadsheet/${fileId}/structure?include_cells=true`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => { setStructure(data); if (data.structures) setActiveSheet(Object.keys(data.structures)[0] || '') })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [isOpen, fileId, token])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) { document.addEventListener('keydown', handleEscape); document.body.style.overflow = 'hidden' }
    return () => { document.removeEventListener('keydown', handleEscape); document.body.style.overflow = '' }
  }, [isOpen, onClose])

  const toggleColumn = useCallback((col: string) => {
    const vis = currentSheetVisibility
    const newHidden = new Set(vis.hiddenColumns)
    const newVisible = new Set(vis.visibleColumns)
    
    if (newHidden.has(col)) {
      newHidden.delete(col)
    } else if (newVisible.has(col)) {
      newVisible.delete(col)
    } else {
      newVisible.add(col)
    }
    setCurrentSheetVisibility({ ...vis, hiddenColumns: newHidden, visibleColumns: newVisible })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const toggleRow = useCallback((row: number) => {
    const vis = currentSheetVisibility
    const newHidden = new Set(vis.hiddenRows)
    const newVisible = new Set(vis.visibleRows)
    
    if (newHidden.has(row)) {
      newHidden.delete(row)
    } else if (newVisible.has(row)) {
      newVisible.delete(row)
    } else {
      newVisible.add(row)
    }
    setCurrentSheetVisibility({ ...vis, hiddenRows: newHidden, visibleRows: newVisible })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const toggleCell = useCallback((cellAddr: string, isNumeric: boolean) => {
    const vis = currentSheetVisibility
    const newHiddenCells = new Set(vis.hiddenCells)
    const newVisibleCells = new Set(vis.visibleCells)
    
    const col = cellAddr.replace(/\d+/g, '')
    const row = parseInt(cellAddr.replace(/[A-Z]+/g, ''))
    const isHidden = isUserHidden(cellAddr, col, row, vis)
    const isWL = isWhitelisted(cellAddr, col, row, vis)
    
    if (isHidden) {
      newHiddenCells.delete(cellAddr)
    } else if (isWL) {
      newVisibleCells.delete(cellAddr)
    } else if (isNumeric) {
      newVisibleCells.add(cellAddr)
    } else {
      newHiddenCells.add(cellAddr)
    }
    setCurrentSheetVisibility({ ...vis, hiddenCells: newHiddenCells, visibleCells: newVisibleCells })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const toggleCells = useCallback((cells: Array<{ addr: string; isNumeric: boolean }>, mode: 'show' | 'hide') => {
    const vis = currentSheetVisibility
    const newHiddenCells = new Set(vis.hiddenCells)
    const newVisibleCells = new Set(vis.visibleCells)
    
    cells.forEach(({ addr, isNumeric }) => {
      if (mode === 'show') {
        newHiddenCells.delete(addr)
        if (isNumeric) newVisibleCells.add(addr)
      } else {
        newVisibleCells.delete(addr)
        if (!isNumeric) newHiddenCells.add(addr)
      }
    })
    setCurrentSheetVisibility({ ...vis, hiddenCells: newHiddenCells, visibleCells: newVisibleCells })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const resetSheet = useCallback(() => setCurrentSheetVisibility(createEmptySheetVisibility()), [setCurrentSheetVisibility])
  
  const resetAll = useCallback(() => {
    if (isUsingNewSystem) {
      onFileVisibilityChange ? onFileVisibilityChange({}) : setInternalFileVisibility({})
    } else if (legacyOnVisibilityChange) {
      legacyOnVisibilityChange(createEmptySheetVisibility())
    }
  }, [isUsingNewSystem, onFileVisibilityChange, legacyOnVisibilityChange])

  if (!isOpen) return null

  const currentSheet = structure?.structures?.[activeSheet]
  const sheetHidden = countHidden(currentSheetVisibility)
  const sheetVisible = countVisible(currentSheetVisibility)

  return (
    <div className="structure-viewer-fullscreen">
      <div className="structure-viewer-header">
        <div className="structure-viewer-title">
          <Shield size={20} className="shield-icon" />
          <span>What AI Sees: {filename}</span>
        </div>
        
        <div className="structure-tabs-inline">
          {structure?.structures && Object.keys(structure.structures).map(sheetName => {
            const sv = ensureFields(fileVisibility[sheetName] ?? {})
            const h = countHidden(sv)
            const v = countVisible(sv)
            return (
              <button key={sheetName} className={`structure-tab ${activeSheet === sheetName ? 'active' : ''}`} onClick={() => setActiveSheet(sheetName)}>
                <Table size={14} />{sheetName}
                {(h > 0 || v > 0) && (
                  <span className="sheet-visibility-badges">
                    {h > 0 && <span className="sheet-hidden-badge"><EyeOff size={10} />{h}</span>}
                    {v > 0 && <span className="sheet-visible-badge"><Eye size={10} />{v}</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="structure-viewer-actions">
          {(sheetHidden > 0 || sheetVisible > 0) && (
            <button className="reset-visibility-btn" onClick={resetSheet} title="Reset this sheet">
              <RotateCcw size={14} /><span>Reset Sheet</span>
            </button>
          )}
          <div className="view-mode-toggle">
            <button className={`mode-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Grid View"><Grid size={16} /></button>
            <button className={`mode-btn ${viewMode === 'summary' ? 'active' : ''}`} onClick={() => setViewMode('summary')} title="Summary View"><Type size={16} /></button>
          </div>
          <button className="structure-close-btn" onClick={onClose}><X size={20} /></button>
        </div>
      </div>

      <div className="structure-viewer-body">
        {loading ? <div className="structure-loading">Loading structure...</div>
        : !currentSheet ? <div className="structure-error">Could not load structure</div>
        : viewMode === 'grid' ? (
          <GridView 
            sheet={currentSheet} 
            sheetName={activeSheet}
            visibility={currentSheetVisibility}
            onToggleColumn={toggleColumn}
            onToggleRow={toggleRow}
            onToggleCell={toggleCell}
            onToggleCells={toggleCells}
          />
        ) : <SummaryView sheet={currentSheet} visibility={currentSheetVisibility} />}
      </div>
    </div>
  )
}

// ============================================================================
// Grid View with Drag Selection and Resizable Columns
// ============================================================================

interface GridViewProps {
  sheet: SheetStructure
  sheetName: string
  visibility: SheetVisibilityState
  onToggleColumn: (col: string) => void
  onToggleRow: (row: number) => void
  onToggleCell: (cellAddr: string, isNumeric: boolean) => void
  onToggleCells: (cells: Array<{ addr: string; isNumeric: boolean }>, mode: 'show' | 'hide') => void
}

function GridView({ sheet, sheetName, visibility, onToggleColumn, onToggleRow, onToggleCell, onToggleCells }: GridViewProps) {
  const maxRows = Math.min(sheet.rows, 100)
  const maxCols = Math.min(sheet.cols, 100)  // Support up to 100 columns (A-CV)
  
  // Selection state
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ col: number; row: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ col: number; row: number } | null>(null)
  const [dragMode, setDragMode] = useState<'show' | 'hide'>('show')
  
  // Column width state
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({})
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({})
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const [resizingRow, setResizingRow] = useState<number | null>(null)
  const resizeStartX = useRef<number>(0)
  const resizeStartY = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)
  const resizeStartHeight = useRef<number>(0)
  
  const DEFAULT_COL_WIDTH = 120
  const DEFAULT_ROW_HEIGHT = 36
  const MIN_COL_WIDTH = 50
  const MIN_ROW_HEIGHT = 24

  const getColWidth = (colIdx: number) => columnWidths[colIdx] ?? DEFAULT_COL_WIDTH
  const getRowHeight = (rowIdx: number) => rowHeights[rowIdx] ?? DEFAULT_ROW_HEIGHT

  const getCellInfo = (rowIdx: number, colIdx: number): { type: string; content: string; isNumeric: boolean; numericValue?: number } => {
    const col = getColumnLetter(colIdx)
    const addr = `${col}${rowIdx + 1}`
    const cellType = sheet.cell_types?.[addr] || 'empty'
    if (sheet.headers?.[addr]) return { type: 'header', content: sheet.headers[addr], isNumeric: false }
    if (sheet.row_labels?.[addr]) return { type: 'label', content: sheet.row_labels[addr], isNumeric: false }
    if (sheet.formulas?.[addr]) return { type: 'formula', content: sheet.formulas[addr], isNumeric: false }
    if (sheet.text_values?.[addr]) return { type: 'text', content: sheet.text_values[addr], isNumeric: false }
    const numericValue = sheet.numeric_values?.[addr]
    if (cellType === 'numeric' || numericValue !== undefined) {
      return { type: 'numeric', content: '', isNumeric: true, numericValue }
    }
    return { type: cellType, content: '', isNumeric: false }
  }

  const getSelectedCells = useCallback(() => {
    if (!dragStart || !dragEnd) return []
    const minCol = Math.min(dragStart.col, dragEnd.col), maxCol = Math.max(dragStart.col, dragEnd.col)
    const minRow = Math.min(dragStart.row, dragEnd.row), maxRow = Math.max(dragStart.row, dragEnd.row)
    const cells: Array<{ addr: string; isNumeric: boolean }> = []
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const addr = `${getColumnLetter(c)}${r + 1}`
        const info = getCellInfo(r, c)
        cells.push({ addr, isNumeric: info.isNumeric })
      }
    }
    return cells
  }, [dragStart, dragEnd, sheet])

  const isInSelection = (colIdx: number, rowIdx: number) => {
    if (!isDragging || !dragStart || !dragEnd) return false
    const minCol = Math.min(dragStart.col, dragEnd.col), maxCol = Math.max(dragStart.col, dragEnd.col)
    const minRow = Math.min(dragStart.row, dragEnd.row), maxRow = Math.max(dragStart.row, dragEnd.row)
    return colIdx >= minCol && colIdx <= maxCol && rowIdx >= minRow && rowIdx <= maxRow
  }

  // Cell selection handlers
  const handleCellMouseDown = (e: React.MouseEvent, colIdx: number, rowIdx: number) => {
    if (e.button !== 0 || resizingCol !== null || resizingRow !== null) return
    e.preventDefault()
    const addr = `${getColumnLetter(colIdx)}${rowIdx + 1}`
    const col = getColumnLetter(colIdx)
    const info = getCellInfo(rowIdx, colIdx)
    
    const isHidden = isUserHidden(addr, col, rowIdx + 1, visibility)
    const isWL = isWhitelisted(addr, col, rowIdx + 1, visibility)
    const isCurrentlyShown = isWL || (!info.isNumeric && !isHidden)
    
    setIsDragging(true)
    setDragStart({ col: colIdx, row: rowIdx })
    setDragEnd({ col: colIdx, row: rowIdx })
    setDragMode(isCurrentlyShown ? 'hide' : 'show')
  }

  const handleCellMouseEnter = (colIdx: number, rowIdx: number) => {
    if (isDragging) setDragEnd({ col: colIdx, row: rowIdx })
  }

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      const cells = getSelectedCells()
      if (cells.length === 1) {
        onToggleCell(cells[0].addr, cells[0].isNumeric)
      } else if (cells.length > 1) {
        onToggleCells(cells, dragMode)
      }
      setIsDragging(false)
      setDragStart(null)
      setDragEnd(null)
    }
    
    // End resize
    if (resizingCol !== null) setResizingCol(null)
    if (resizingRow !== null) setResizingRow(null)
  }, [isDragging, getSelectedCells, dragMode, onToggleCell, onToggleCells, resizingCol, resizingRow])

  // Column resize handlers
  const handleColResizeStart = (e: React.MouseEvent, colIdx: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingCol(colIdx)
    resizeStartX.current = e.clientX
    resizeStartWidth.current = getColWidth(colIdx)
  }

  // Row resize handlers
  const handleRowResizeStart = (e: React.MouseEvent, rowIdx: number) => {
    e.preventDefault()
    e.stopPropagation()
    setResizingRow(rowIdx)
    resizeStartY.current = e.clientY
    resizeStartHeight.current = getRowHeight(rowIdx)
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (resizingCol !== null) {
      const delta = e.clientX - resizeStartX.current
      const newWidth = Math.max(MIN_COL_WIDTH, resizeStartWidth.current + delta)
      setColumnWidths(prev => ({ ...prev, [resizingCol]: newWidth }))
    }
    if (resizingRow !== null) {
      const delta = e.clientY - resizeStartY.current
      const newHeight = Math.max(MIN_ROW_HEIGHT, resizeStartHeight.current + delta)
      setRowHeights(prev => ({ ...prev, [resizingRow]: newHeight }))
    }
  }, [resizingCol, resizingRow])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }, [handleMouseUp, handleMouseMove])

  const isResizing = resizingCol !== null || resizingRow !== null

  return (
    <div className="grid-view-fullscreen">
      <div className="grid-instructions">
        <span>Click to toggle · Drag to select · Drag edges to resize · <Eye size={12} style={{color:'#22c55a'}}/> = shown to AI</span>
        <span className="sheet-indicator">Sheet: <strong>{sheetName}</strong></span>
      </div>
      <div className="grid-scroll-container">
        <table className={`structure-grid ${isResizing ? 'resizing' : ''}`}>
          <thead>
            <tr>
              <th className="corner-cell" style={{ width: 50 }}></th>
              {Array.from({ length: maxCols }, (_, i) => {
                const col = getColumnLetter(i)
                const isHidden = visibility.hiddenColumns?.has(col)
                const isWL = visibility.visibleColumns?.has(col)
                const width = getColWidth(i)
                return (
                  <th 
                    key={i} 
                    className={`col-header clickable ${isHidden ? 'user-hidden' : ''} ${isWL ? 'user-visible' : ''}`}
                    style={{ width, minWidth: width, maxWidth: width }}
                    onClick={() => onToggleColumn(col)}
                    title={`Column ${col}: Click to toggle`}
                  >
                    <span className="col-letter">{col}</span>
                    {isWL && <Eye size={10} className="visible-indicator" />}
                    {isHidden && <EyeOff size={10} className="hidden-indicator" />}
                    <div 
                      className={`col-resize-handle ${resizingCol === i ? 'resizing' : ''}`}
                      onMouseDown={(e) => handleColResizeStart(e, i)}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }, (_, rowIdx) => {
              const rowNum = rowIdx + 1
              const isRowHidden = visibility.hiddenRows?.has(rowNum)
              const isRowWL = visibility.visibleRows?.has(rowNum)
              const height = getRowHeight(rowIdx)
              
              return (
                <tr key={rowIdx} className={`${isRowHidden ? 'row-hidden' : ''} ${isRowWL ? 'row-visible' : ''}`}>
                  <td 
                    className={`row-header clickable ${isRowHidden ? 'user-hidden' : ''} ${isRowWL ? 'user-visible' : ''}`}
                    style={{ height, minHeight: height }}
                    onClick={() => onToggleRow(rowNum)}
                    title={`Row ${rowNum}: Click to toggle`}
                  >
                    <span className="row-number">{rowNum}</span>
                    {isRowWL && <Eye size={10} className="visible-indicator" />}
                    {isRowHidden && <EyeOff size={10} className="hidden-indicator" />}
                    <div 
                      className={`row-resize-handle ${resizingRow === rowIdx ? 'resizing' : ''}`}
                      onMouseDown={(e) => handleRowResizeStart(e, rowIdx)}
                    />
                  </td>
                  {Array.from({ length: maxCols }, (_, colIdx) => {
                    const col = getColumnLetter(colIdx)
                    const addr = `${col}${rowNum}`
                    const { type, content, isNumeric, numericValue } = getCellInfo(rowIdx, colIdx)
                    const isHidden = isUserHidden(addr, col, rowNum, visibility)
                    const isWL = isWhitelisted(addr, col, rowNum, visibility)
                    const inSel = isInSelection(colIdx, rowIdx)
                    const width = getColWidth(colIdx)
                    
                    const displayValue = numericValue !== undefined 
                      ? numericValue.toLocaleString('en-US', { maximumFractionDigits: 2 })
                      : null
                    
                    return (
                      <td 
                        key={colIdx} 
                        className={`grid-cell ${type} ${isHidden ? 'user-hidden' : ''} ${isWL ? 'user-visible' : ''} ${inSel ? 'in-selection' : ''}`}
                        style={{ width, minWidth: width, maxWidth: width, height }}
                        onMouseDown={(e) => handleCellMouseDown(e, colIdx, rowIdx)}
                        onMouseEnter={() => handleCellMouseEnter(colIdx, rowIdx)}
                        title={`${addr}: Click to toggle${isWL && displayValue ? ` (${displayValue})` : ''}`}
                      >
                        <div className="cell-content">
                          {isHidden ? (
                            <EyeOff size={10} className="hidden-icon user-hidden-icon" />
                          ) : isWL && isNumeric ? (
                            displayValue ? (
                              <span className="cell-number-value">{displayValue}</span>
                            ) : (
                              <Eye size={10} className="visible-icon" />
                            )
                          ) : isNumeric ? (
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
        {countHidden(visibility) > 0 && <span className="hidden-count"> · {countHidden(visibility)} extra hidden</span>}
        {countVisible(visibility) > 0 && <span className="visible-count"> · {countVisible(visibility)} numbers shown</span>}
      </div>
    </div>
  )
}

// ============================================================================
// Summary View
// ============================================================================

interface SummaryViewProps {
  sheet: SheetStructure
  visibility: SheetVisibilityState
}

function SummaryView({ sheet, visibility }: SummaryViewProps) {
  const headersArray = Object.entries(sheet.headers || {}).sort((a, b) => a[0].replace(/\d+/g, '').localeCompare(b[0].replace(/\d+/g, '')))
  const rowLabelsArray = Object.entries(sheet.row_labels || {}).slice(0, 30)

  return (
    <div className="summary-view-fullscreen">
      <div className="summary-grid">
        <div className="summary-card">
          <h3><Hash size={16} /> Dimensions</h3>
          <div className="summary-stat"><span className="stat-value">{sheet.rows}</span><span className="stat-label">rows</span></div>
          <div className="summary-stat"><span className="stat-value">{sheet.cols}</span><span className="stat-label">columns</span></div>
        </div>

        {(countHidden(visibility) > 0 || countVisible(visibility) > 0) && (
          <div className="summary-card visibility-summary">
            <h3><Shield size={16} /> Privacy Changes</h3>
            {visibility.hiddenColumns?.size > 0 && <div className="vis-item"><EyeOff size={12} /><span>Hidden cols: {[...visibility.hiddenColumns].sort().join(', ')}</span></div>}
            {visibility.hiddenRows?.size > 0 && <div className="vis-item"><EyeOff size={12} /><span>Hidden rows: {[...visibility.hiddenRows].sort((a,b)=>a-b).join(', ')}</span></div>}
            {visibility.hiddenCells?.size > 0 && <div className="vis-item"><EyeOff size={12} /><span>Hidden cells: {[...visibility.hiddenCells].sort().join(', ')}</span></div>}
            {visibility.visibleColumns?.size > 0 && <div className="vis-item visible"><Eye size={12} /><span>Shown cols: {[...visibility.visibleColumns].sort().join(', ')}</span></div>}
            {visibility.visibleRows?.size > 0 && <div className="vis-item visible"><Eye size={12} /><span>Shown rows: {[...visibility.visibleRows].sort((a,b)=>a-b).join(', ')}</span></div>}
            {visibility.visibleCells?.size > 0 && <div className="vis-item visible"><Eye size={12} /><span>Shown cells: {[...visibility.visibleCells].sort().join(', ')}</span></div>}
          </div>
        )}

        <div className="summary-card">
          <h3><Eye size={16} /> Cell Types</h3>
          {Object.entries(sheet.cell_type_counts || {}).map(([type, count]) => (
            <div key={type} className="cell-type-row"><span className={`cell-type-dot ${type}`} /><span className="cell-type-name">{type}</span><span className="cell-type-count">{count}</span></div>
          ))}
        </div>

        <div className="summary-card wide">
          <h3><Type size={16} /> Headers</h3>
          <div className="tags-container">
            {headersArray.length > 0 ? headersArray.map(([cell, header]) => {
              const col = cell.replace(/\d+/g, ''), row = parseInt(cell.replace(/[A-Z]+/g, ''))
              const hidden = isUserHidden(cell, col, row, visibility)
              return <span key={cell} className={`structure-tag header-tag ${hidden ? 'user-hidden' : ''}`}><span className="tag-cell">{cell}</span>{hidden ? <EyeOff size={10} /> : header}</span>
            }) : <span className="no-data">No headers detected</span>}
          </div>
        </div>

        {rowLabelsArray.length > 0 && (
          <div className="summary-card wide">
            <h3><Table size={16} /> Row Labels</h3>
            <div className="tags-container">
              {rowLabelsArray.map(([cell, label]) => {
                const col = cell.replace(/\d+/g, ''), row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const hidden = isUserHidden(cell, col, row, visibility)
                return <span key={cell} className={`structure-tag row-tag ${hidden ? 'user-hidden' : ''}`}><span className="tag-cell">{cell}</span>{hidden ? <EyeOff size={10} /> : label}</span>
              })}
            </div>
          </div>
        )}

        {Object.keys(sheet.formulas || {}).length > 0 && (
          <div className="summary-card wide">
            <h3><Calculator size={16} /> Formulas</h3>
            <div className="formulas-list">
              {Object.entries(sheet.formulas).slice(0, 20).map(([cell, formula]) => {
                const col = cell.replace(/\d+/g, ''), row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const hidden = isUserHidden(cell, col, row, visibility)
                return <div key={cell} className={`formula-row ${hidden ? 'user-hidden' : ''}`}><span className="formula-cell">{cell}</span>{hidden ? <span className="formula-hidden"><EyeOff size={12} /></span> : <code className="formula-code">{formula}</code>}</div>
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}