import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Table, Hash, Type, Calculator, Grid, Eye, EyeOff, Shield, RotateCcw, MessageSquare, Hexagon } from 'lucide-react'
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

// Selection range for Ask AI callback
export interface SelectionRange {
  sheetName: string
  startCell: string
  endCell: string
  cells: string[]
  rangeString: string // e.g., "A1:B5" or "A1" for single cell
}

interface StructureViewerProps {
  fileId: string
  filename: string
  // Mode: modal (with overlay/close) or inline (embedded in page)
  mode?: 'modal' | 'inline'
  // For modal mode
  isOpen?: boolean
  onClose?: () => void
  // Visibility
  fileVisibility?: FileVisibilityState
  onFileVisibilityChange?: (visibility: FileVisibilityState) => void
  // Legacy visibility props (deprecated)
  visibility?: SheetVisibilityState
  onVisibilityChange?: (visibility: SheetVisibilityState) => void
  // Ask AI callback - when user selects cells and clicks "Ask R-O-AI"
  onAskAI?: (selection: SelectionRange) => void
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

// ============================================================================
// Main Component
// ============================================================================

export function StructureViewer({ 
  fileId, 
  filename, 
  mode = 'modal',
  isOpen = true,
  onClose,
  fileVisibility: externalFileVisibility,
  onFileVisibilityChange,
  visibility: legacyVisibility,
  onVisibilityChange: legacyOnVisibilityChange,
  onAskAI,
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

  // Fetch data - for modal mode only when isOpen, for inline always
  const shouldFetch = mode === 'inline' || isOpen
  
  useEffect(() => {
    if (shouldFetch && fileId && token) {
      setLoading(true)
      fetch(`/api/spreadsheet/${fileId}/structure?include_cells=true`, { 
        headers: { 'Authorization': `Bearer ${token}` } 
      })
        .then(res => res.json())
        .then(data => { 
          setStructure(data)
          if (data.structures) setActiveSheet(Object.keys(data.structures)[0] || '') 
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [shouldFetch, fileId, token])

  // Escape key to close (modal mode only)
  useEffect(() => {
    if (mode !== 'modal' || !isOpen) return
    
    const handleEscape = (e: KeyboardEvent) => { 
      if (e.key === 'Escape') onClose?.() 
    }
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    
    return () => { 
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = '' 
    }
  }, [mode, isOpen, onClose])

  // Visibility toggle functions
  const toggleCells = useCallback((cells: Array<{ addr: string; isNumeric: boolean }>, action: 'show' | 'hide') => {
    const vis = currentSheetVisibility
    const newHiddenCells = new Set(vis.hiddenCells)
    const newVisibleCells = new Set(vis.visibleCells)
    
    cells.forEach(({ addr, isNumeric }) => {
      if (action === 'show') {
        newHiddenCells.delete(addr)
        if (isNumeric) newVisibleCells.add(addr)
      } else {
        newVisibleCells.delete(addr)
        if (!isNumeric) newHiddenCells.add(addr)
      }
    })
    setCurrentSheetVisibility({ ...vis, hiddenCells: newHiddenCells, visibleCells: newVisibleCells })
  }, [currentSheetVisibility, setCurrentSheetVisibility])

  const resetSheet = useCallback(() => {
    setCurrentSheetVisibility(createEmptySheetVisibility())
  }, [setCurrentSheetVisibility])

  // Don't render if modal mode and not open
  if (mode === 'modal' && !isOpen) return null

  const currentSheet = structure?.structures?.[activeSheet]
  const sheetHidden = countHidden(currentSheetVisibility)
  const sheetVisible = countVisible(currentSheetVisibility)
  const sheetNames = structure?.structures ? Object.keys(structure.structures) : []

  // Container class based on mode
  const containerClass = mode === 'modal' 
    ? 'structure-viewer-fullscreen' 
    : 'structure-viewer-inline'

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="structure-viewer-header">
        <div className="structure-viewer-title">
          <Shield size={18} className="shield-icon" />
          <span>{mode === 'modal' ? `What AI Sees: ${filename}` : filename}</span>
        </div>
        
        {/* Sheet Tabs */}
        <div className="structure-tabs-inline">
          {sheetNames.map(sheetName => {
            const sv = ensureFields(fileVisibility[sheetName] ?? {})
            const h = countHidden(sv)
            const v = countVisible(sv)
            return (
              <button 
                key={sheetName} 
                className={`structure-tab ${activeSheet === sheetName ? 'active' : ''}`} 
                onClick={() => setActiveSheet(sheetName)}
              >
                <Table size={14} />
                {sheetName}
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

        {/* Actions */}
        <div className="structure-viewer-actions">
          {(sheetHidden > 0 || sheetVisible > 0) && (
            <button className="reset-visibility-btn" onClick={resetSheet} title="Reset this sheet">
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          )}
          <div className="view-mode-toggle">
            <button 
              className={`mode-btn ${viewMode === 'grid' ? 'active' : ''}`} 
              onClick={() => setViewMode('grid')} 
              title="Grid View"
            >
              <Grid size={16} />
            </button>
            <button 
              className={`mode-btn ${viewMode === 'summary' ? 'active' : ''}`} 
              onClick={() => setViewMode('summary')} 
              title="Summary View"
            >
              <Type size={16} />
            </button>
          </div>
          {mode === 'modal' && onClose && (
            <button className="structure-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="structure-viewer-body">
        {loading ? (
          <div className="structure-loading">
            <div className="loading-spinner" />
            <span>Loading structure...</span>
          </div>
        ) : !currentSheet ? (
          <div className="structure-error">Could not load structure</div>
        ) : viewMode === 'grid' ? (
          <GridView 
            sheet={currentSheet} 
            sheetName={activeSheet}
            visibility={currentSheetVisibility}
            onToggleCells={toggleCells}
            onAskAI={onAskAI}
          />
        ) : (
          <SummaryView sheet={currentSheet} visibility={currentSheetVisibility} />
        )}
      </div>
      
      {/* Footer - info bar */}
      {currentSheet && (
        <div className="structure-viewer-footer">
          <span>{currentSheet.rows} rows × {currentSheet.cols} columns</span>
          {sheetHidden > 0 && <span className="hidden-count">· {sheetHidden} hidden</span>}
          {sheetVisible > 0 && <span className="visible-count">· {sheetVisible} shown</span>}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Grid View with Selection + Action Menu
// ============================================================================

interface GridViewProps {
  sheet: SheetStructure
  sheetName: string
  visibility: SheetVisibilityState
  onToggleCells: (cells: Array<{ addr: string; isNumeric: boolean }>, action: 'show' | 'hide') => void
  onAskAI?: (selection: SelectionRange) => void
}

function GridView({ sheet, sheetName, visibility, onToggleCells, onAskAI }: GridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  
  const maxRows = Math.min(sheet.rows, 500)
  const maxCols = Math.min(sheet.cols, 100)
  
  // Selection state - now supports cells, rows, or columns
  type SelectionType = 'cells' | 'row' | 'column'
  const [isDragging, setIsDragging] = useState(false)
  const [selectionType, setSelectionType] = useState<SelectionType>('cells')
  const [selection, setSelection] = useState<{ start: { col: number; row: number }; end: { col: number; row: number } } | null>(null)
  
  // Action menu state
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  
  // Column/row resize state
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({})
  const [rowHeights, setRowHeights] = useState<Record<number, number>>({})
  const [resizingCol, setResizingCol] = useState<number | null>(null)
  const [resizingRow, setResizingRow] = useState<number | null>(null)
  const resizeStartX = useRef<number>(0)
  const resizeStartY = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)
  const resizeStartHeight = useRef<number>(0)
  
  const DEFAULT_COL_WIDTH = 120
  const DEFAULT_ROW_HEIGHT = 32
  const MIN_COL_WIDTH = 50
  const MIN_ROW_HEIGHT = 24

  const getColWidth = (colIdx: number) => columnWidths[colIdx] ?? DEFAULT_COL_WIDTH
  const getRowHeight = (rowIdx: number) => rowHeights[rowIdx] ?? DEFAULT_ROW_HEIGHT

  const getCellInfo = (rowIdx: number, colIdx: number) => {
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

  // Get selected cells info - handles cells, rows, and columns
  const getSelectedCells = useCallback(() => {
    if (!selection) return []
    const { start, end } = selection
    
    let minCol: number, maxCol: number, minRow: number, maxRow: number
    
    if (selectionType === 'column') {
      // Full column selection - all rows
      minCol = Math.min(start.col, end.col)
      maxCol = Math.max(start.col, end.col)
      minRow = 0
      maxRow = maxRows - 1
    } else if (selectionType === 'row') {
      // Full row selection - all columns
      minCol = 0
      maxCol = maxCols - 1
      minRow = Math.min(start.row, end.row)
      maxRow = Math.max(start.row, end.row)
    } else {
      // Cell range selection
      minCol = Math.min(start.col, end.col)
      maxCol = Math.max(start.col, end.col)
      minRow = Math.min(start.row, end.row)
      maxRow = Math.max(start.row, end.row)
    }
    
    const cells: Array<{ addr: string; isNumeric: boolean }> = []
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const addr = `${getColumnLetter(c)}${r + 1}`
        const info = getCellInfo(r, c)
        cells.push({ addr, isNumeric: info.isNumeric })
      }
    }
    return cells
  }, [selection, selectionType, maxRows, maxCols, sheet])

  // Build selection range for Ask AI - handles cells, rows, and columns
  const getSelectionRange = useCallback((): SelectionRange | null => {
    if (!selection) return null
    const { start, end } = selection
    
    let rangeString: string
    let startCell: string
    let endCell: string
    
    if (selectionType === 'column') {
      // Column selection: "A" or "A:C"
      const minCol = Math.min(start.col, end.col)
      const maxCol = Math.max(start.col, end.col)
      const startColLetter = getColumnLetter(minCol)
      const endColLetter = getColumnLetter(maxCol)
      startCell = `${startColLetter}1`
      endCell = `${endColLetter}${maxRows}`
      rangeString = minCol === maxCol 
        ? `Column ${startColLetter}` 
        : `Columns ${startColLetter}:${endColLetter}`
    } else if (selectionType === 'row') {
      // Row selection: "1" or "1:5"
      const minRow = Math.min(start.row, end.row) + 1
      const maxRow = Math.max(start.row, end.row) + 1
      startCell = `A${minRow}`
      endCell = `${getColumnLetter(maxCols - 1)}${maxRow}`
      rangeString = minRow === maxRow 
        ? `Row ${minRow}` 
        : `Rows ${minRow}:${maxRow}`
    } else {
      // Cell range: "A1" or "A1:B5"
      const minCol = Math.min(start.col, end.col)
      const maxCol = Math.max(start.col, end.col)
      const minRow = Math.min(start.row, end.row)
      const maxRow = Math.max(start.row, end.row)
      startCell = `${getColumnLetter(minCol)}${minRow + 1}`
      endCell = `${getColumnLetter(maxCol)}${maxRow + 1}`
      rangeString = startCell === endCell ? startCell : `${startCell}:${endCell}`
    }
    
    const cells = getSelectedCells().map(c => c.addr)
    
    return { sheetName, startCell, endCell, cells, rangeString }
  }, [selection, selectionType, sheetName, maxRows, maxCols, getSelectedCells])

  const isInSelection = (colIdx: number, rowIdx: number) => {
    if (!selection) return false
    const { start, end } = selection
    
    if (selectionType === 'column') {
      // Full column selection - check if column is in range
      const minCol = Math.min(start.col, end.col)
      const maxCol = Math.max(start.col, end.col)
      return colIdx >= minCol && colIdx <= maxCol
    } else if (selectionType === 'row') {
      // Full row selection - check if row is in range
      const minRow = Math.min(start.row, end.row)
      const maxRow = Math.max(start.row, end.row)
      return rowIdx >= minRow && rowIdx <= maxRow
    } else {
      // Cell range selection
      const minCol = Math.min(start.col, end.col), maxCol = Math.max(start.col, end.col)
      const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row)
      return colIdx >= minCol && colIdx <= maxCol && rowIdx >= minRow && rowIdx <= maxRow
    }
  }
  
  // Check if a column header is selected
  const isColumnSelected = (colIdx: number) => {
    if (!selection || selectionType !== 'column') return false
    const minCol = Math.min(selection.start.col, selection.end.col)
    const maxCol = Math.max(selection.start.col, selection.end.col)
    return colIdx >= minCol && colIdx <= maxCol
  }
  
  // Check if a row header is selected
  const isRowSelected = (rowIdx: number) => {
    if (!selection || selectionType !== 'row') return false
    const minRow = Math.min(selection.start.row, selection.end.row)
    const maxRow = Math.max(selection.start.row, selection.end.row)
    return rowIdx >= minRow && rowIdx <= maxRow
  }

  // Cell selection handlers
  const handleCellMouseDown = (e: React.MouseEvent, colIdx: number, rowIdx: number) => {
    if (e.button !== 0 || resizingCol !== null || resizingRow !== null) return
    e.preventDefault()
    
    // Close any open menu
    setShowActionMenu(false)
    
    setIsDragging(true)
    setSelectionType('cells')
    setSelection({ start: { col: colIdx, row: rowIdx }, end: { col: colIdx, row: rowIdx } })
  }

  const handleCellMouseEnter = (colIdx: number, rowIdx: number) => {
    if (isDragging && selection) {
      if (selectionType === 'cells') {
        setSelection({ ...selection, end: { col: colIdx, row: rowIdx } })
      } else if (selectionType === 'column') {
        setSelection({ ...selection, end: { col: colIdx, row: selection.end.row } })
      } else if (selectionType === 'row') {
        setSelection({ ...selection, end: { col: selection.end.col, row: rowIdx } })
      }
    }
  }
  
  // Column header click - select entire column
  const handleColumnMouseDown = (e: React.MouseEvent, colIdx: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    
    // Close any open menu
    setShowActionMenu(false)
    
    setIsDragging(true)
    setSelectionType('column')
    setSelection({ start: { col: colIdx, row: 0 }, end: { col: colIdx, row: maxRows - 1 } })
  }
  
  // Row header click - select entire row
  const handleRowMouseDown = (e: React.MouseEvent, rowIdx: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    
    // Close any open menu
    setShowActionMenu(false)
    
    setIsDragging(true)
    setSelectionType('row')
    setSelection({ start: { col: 0, row: rowIdx }, end: { col: maxCols - 1, row: rowIdx } })
  }
  
  // Handle drag over column headers
  const handleColumnMouseEnter = (colIdx: number) => {
    if (isDragging && selectionType === 'column' && selection) {
      setSelection({ ...selection, end: { col: colIdx, row: maxRows - 1 } })
    }
  }
  
  // Handle drag over row headers
  const handleRowMouseEnter = (rowIdx: number) => {
    if (isDragging && selectionType === 'row' && selection) {
      setSelection({ ...selection, end: { col: maxCols - 1, row: rowIdx } })
    }
  }

  const handleMouseUp = useCallback((e: MouseEvent) => {
    // Handle column/row resize end
    if (resizingCol !== null) setResizingCol(null)
    if (resizingRow !== null) setResizingRow(null)
    
    // Handle selection end - show action menu
    if (isDragging && selection) {
      setIsDragging(false)
      
      // Calculate menu position near the selection end
      const gridRect = gridRef.current?.getBoundingClientRect()
      if (gridRect) {
        // Position menu near mouse, but keep it within viewport
        const menuX = Math.min(e.clientX, window.innerWidth - 200)
        const menuY = Math.min(e.clientY + 10, window.innerHeight - 120)
        setMenuPosition({ x: menuX, y: menuY })
        setShowActionMenu(true)
      }
    }
  }, [isDragging, selection, resizingCol, resizingRow])

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

  // Click outside to dismiss menu
  const handleClickOutside = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (showActionMenu && !target.closest('.selection-action-menu')) {
      setShowActionMenu(false)
      setSelection(null)
    }
  }, [showActionMenu])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mousedown', handleClickOutside)
    
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [handleMouseUp, handleMouseMove, handleClickOutside])

  // Action handlers
  const handleAskAI = () => {
    const range = getSelectionRange()
    if (range && onAskAI) {
      onAskAI(range)
    }
    setShowActionMenu(false)
    setSelection(null)
  }

  const handleHide = () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      onToggleCells(cells, 'hide')
    }
    setShowActionMenu(false)
    setSelection(null)
  }

  const handleShow = () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      onToggleCells(cells, 'show')
    }
    setShowActionMenu(false)
    setSelection(null)
  }

  const isResizing = resizingCol !== null || resizingRow !== null
  const selectionRange = getSelectionRange()

  return (
    <div className="grid-view-fullscreen" ref={gridRef}>
      {/* Instructions */}
      <div className="grid-instructions">
        <span>Click headers to select rows/columns · Drag cells to select range · <Eye size={12} style={{color:'#22c55a'}}/> shown · <EyeOff size={12} style={{color:'#ef4444'}}/> hidden</span>
        <span className="sheet-indicator">Sheet: <strong>{sheetName}</strong></span>
      </div>
      
      {/* Grid */}
      <div className="grid-scroll-container">
        <table className={`structure-grid ${isResizing ? 'resizing' : ''} ${isDragging ? 'selecting' : ''}`}>
          <thead>
            <tr>
              <th className="corner-cell" style={{ width: 50 }}>#</th>
              {Array.from({ length: maxCols }, (_, i) => {
                const col = getColumnLetter(i)
                const isHidden = visibility.hiddenColumns?.has(col)
                const isWL = visibility.visibleColumns?.has(col)
                const width = getColWidth(i)
                const isSelected = isColumnSelected(i)
                
                return (
                  <th 
                    key={i} 
                    className={`col-header clickable ${isHidden ? 'user-hidden' : ''} ${isWL ? 'user-visible' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ width, minWidth: width, maxWidth: width }}
                    onMouseDown={(e) => handleColumnMouseDown(e, i)}
                    onMouseEnter={() => handleColumnMouseEnter(i)}
                    title={`Column ${col}: Click to select`}
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
              const isSelected = isRowSelected(rowIdx)
              
              return (
                <tr key={rowIdx} className={`${isRowHidden ? 'row-hidden' : ''} ${isRowWL ? 'row-visible' : ''}`}>
                  <td 
                    className={`row-header clickable ${isRowHidden ? 'user-hidden' : ''} ${isRowWL ? 'user-visible' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ height, minHeight: height }}
                    onMouseDown={(e) => handleRowMouseDown(e, rowIdx)}
                    onMouseEnter={() => handleRowMouseEnter(rowIdx)}
                    title={`Row ${rowNum}: Click to select`}
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

      {/* Selection Action Menu */}
      {showActionMenu && selection && (
        <SelectionActionMenu
          position={menuPosition}
          rangeString={selectionRange?.rangeString || ''}
          onAskAI={onAskAI ? handleAskAI : undefined}
          onHide={handleHide}
          onShow={handleShow}
          onClose={() => { setShowActionMenu(false); setSelection(null) }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Selection Action Menu (iOS-style floating menu)
// ============================================================================

interface SelectionActionMenuProps {
  position: { x: number; y: number }
  rangeString: string
  onAskAI?: () => void
  onHide: () => void
  onShow: () => void
  onClose: () => void
}

function SelectionActionMenu({ position, rangeString, onAskAI, onHide, onShow, onClose }: SelectionActionMenuProps) {
  return (
    <div 
      className="selection-action-menu"
      style={{ 
        position: 'fixed',
        left: position.x,
        top: position.y,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="action-menu-header">
        <span className="action-menu-range">{rangeString}</span>
      </div>
      <div className="action-menu-buttons">
        {onAskAI && (
          <button className="action-menu-btn ask-ai" onClick={onAskAI}>
            <Hexagon size={14} />
            <span>Ask R-O-AI</span>
          </button>
        )}
        <button className="action-menu-btn hide" onClick={onHide}>
          <EyeOff size={14} />
          <span>Hide</span>
        </button>
        <button className="action-menu-btn show" onClick={onShow}>
          <Eye size={14} />
          <span>Show</span>
        </button>
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
  const headersArray = Object.entries(sheet.headers || {}).sort((a, b) => 
    a[0].replace(/\d+/g, '').localeCompare(b[0].replace(/\d+/g, ''))
  )
  const rowLabelsArray = Object.entries(sheet.row_labels || {}).slice(0, 30)

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

        {(countHidden(visibility) > 0 || countVisible(visibility) > 0) && (
          <div className="summary-card visibility-summary">
            <h3><Shield size={16} /> Privacy Changes</h3>
            {visibility.hiddenColumns?.size > 0 && (
              <div className="vis-item">
                <EyeOff size={12} />
                <span>Hidden cols: {[...visibility.hiddenColumns].sort().join(', ')}</span>
              </div>
            )}
            {visibility.hiddenRows?.size > 0 && (
              <div className="vis-item">
                <EyeOff size={12} />
                <span>Hidden rows: {[...visibility.hiddenRows].sort((a,b)=>a-b).join(', ')}</span>
              </div>
            )}
            {visibility.hiddenCells?.size > 0 && (
              <div className="vis-item">
                <EyeOff size={12} />
                <span>Hidden cells: {[...visibility.hiddenCells].sort().join(', ')}</span>
              </div>
            )}
            {visibility.visibleColumns?.size > 0 && (
              <div className="vis-item visible">
                <Eye size={12} />
                <span>Shown cols: {[...visibility.visibleColumns].sort().join(', ')}</span>
              </div>
            )}
            {visibility.visibleRows?.size > 0 && (
              <div className="vis-item visible">
                <Eye size={12} />
                <span>Shown rows: {[...visibility.visibleRows].sort((a,b)=>a-b).join(', ')}</span>
              </div>
            )}
            {visibility.visibleCells?.size > 0 && (
              <div className="vis-item visible">
                <Eye size={12} />
                <span>Shown cells: {[...visibility.visibleCells].sort().join(', ')}</span>
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
            {headersArray.length > 0 ? headersArray.map(([cell, header]) => {
              const col = cell.replace(/\d+/g, '')
              const row = parseInt(cell.replace(/[A-Z]+/g, ''))
              const hidden = isUserHidden(cell, col, row, visibility)
              return (
                <span key={cell} className={`structure-tag header-tag ${hidden ? 'user-hidden' : ''}`}>
                  <span className="tag-cell">{cell}</span>
                  {hidden ? <EyeOff size={10} /> : header}
                </span>
              )
            }) : <span className="no-data">No headers detected</span>}
          </div>
        </div>

        {rowLabelsArray.length > 0 && (
          <div className="summary-card wide">
            <h3><Table size={16} /> Row Labels</h3>
            <div className="tags-container">
              {rowLabelsArray.map(([cell, label]) => {
                const col = cell.replace(/\d+/g, '')
                const row = parseInt(cell.replace(/[A-Z]+/g, ''))
                const hidden = isUserHidden(cell, col, row, visibility)
                return (
                  <span key={cell} className={`structure-tag row-tag ${hidden ? 'user-hidden' : ''}`}>
                    <span className="tag-cell">{cell}</span>
                    {hidden ? <EyeOff size={10} /> : label}
                  </span>
                )
              })}
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
                const hidden = isUserHidden(cell, col, row, visibility)
                return (
                  <div key={cell} className={`formula-row ${hidden ? 'user-hidden' : ''}`}>
                    <span className="formula-cell">{cell}</span>
                    {hidden ? (
                      <span className="formula-hidden"><EyeOff size={12} /></span>
                    ) : (
                      <code className="formula-code">{formula}</code>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}