import { useState, useEffect } from 'react'
import { X, Table, FileSpreadsheet, Hash, Type, Calculator, Grid, Eye, EyeOff, Shield, Maximize2, Minimize2 } from 'lucide-react'
import { useAuth } from '../hooks'

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

interface StructureViewerProps {
  fileId: string
  filename: string
  isOpen: boolean
  onClose: () => void
}

type ViewMode = 'summary' | 'grid'

export function StructureViewer({ fileId, filename, isOpen, onClose }: StructureViewerProps) {
  const { token } = useAuth()
  const [structure, setStructure] = useState<StructureData | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

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
            setActiveSheet(Object.keys(data.structures)[0] || '')
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

  if (!isOpen) return null

  const currentSheet = structure?.structures?.[activeSheet]

  return (
    <div className="structure-viewer-fullscreen">
      <div className="structure-viewer-header">
        <div className="structure-viewer-title">
          <Shield size={20} className="shield-icon" />
          <span>What AI Sees: {filename}</span>
        </div>
        
        <div className="structure-tabs-inline">
          {structure?.structures && Object.keys(structure.structures).map(sheetName => (
            <button
              key={sheetName}
              className={`structure-tab ${activeSheet === sheetName ? 'active' : ''}`}
              onClick={() => setActiveSheet(sheetName)}
            >
              <Table size={14} />
              {sheetName}
            </button>
          ))}
        </div>

        <div className="structure-viewer-actions">
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
          <button className="structure-viewer-close" onClick={onClose} title="Close (Esc)">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="structure-viewer-body">
        {loading ? (
          <div className="structure-viewer-loading">Loading structure...</div>
        ) : structure?.structures ? (
          <>
            {currentSheet && viewMode === 'grid' && (
              <GridView sheet={currentSheet} sheetName={activeSheet} />
            )}

            {currentSheet && viewMode === 'summary' && (
              <SummaryView sheet={currentSheet} />
            )}
          </>
        ) : (
          <div className="structure-viewer-error">
            Could not load structure. Try re-uploading the file.
          </div>
        )}
      </div>

      <div className="structure-viewer-footer">
        <div className="structure-legend">
          <div className="legend-title"><Shield size={14} /> Cell Types:</div>
          <div className="legend-items">
            <div className="legend-item">
              <span className="legend-dot text" />
              <span>Text (visible)</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot numeric" />
              <span>Numeric (hidden)</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot formula" />
              <span>Formula (visible)</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot empty" />
              <span>Empty</span>
            </div>
          </div>
        </div>
        
        <div className="security-badge">
          <EyeOff size={14} />
          <span>Numeric values hidden from AI</span>
        </div>
      </div>
    </div>
  )
}

interface GridViewProps {
  sheet: SheetStructure
  sheetName: string
}

function GridView({ sheet }: GridViewProps) {
  // Show ALL rows and columns
  const maxDisplayRows = sheet.rows
  const maxDisplayCols = sheet.cols

  const getColumnLetter = (idx: number): string => {
    let letter = ''
    let n = idx
    while (n >= 0) {
      letter = String.fromCharCode(65 + (n % 26)) + letter
      n = Math.floor(n / 26) - 1
    }
    return letter
  }

  const getCellContent = (row: number, col: number): { type: string; content: string } => {
    const cellAddr = `${getColumnLetter(col)}${row + 1}`
    
    if (sheet.headers && sheet.headers[cellAddr]) {
      return { type: 'header', content: sheet.headers[cellAddr] }
    }
    
    if (sheet.formulas && sheet.formulas[cellAddr]) {
      return { type: 'formula', content: sheet.formulas[cellAddr] }
    }
    
    if (sheet.cell_types?.[cellAddr]) {
      const cellType = sheet.cell_types[cellAddr]
      if (cellType === 'numeric') {
        return { type: 'numeric', content: '' }
      } else if (cellType === 'empty') {
        return { type: 'empty', content: '' }
      } else if (cellType === 'text') {
        const textValue = sheet.text_values?.[cellAddr] || sheet.row_labels?.[cellAddr]
        return { type: 'text', content: textValue || '' }
      } else if (cellType === 'formula') {
        return { type: 'formula', content: sheet.formulas?.[cellAddr] || '' }
      }
    }
    
    return { type: 'empty', content: '' }
  }

  return (
    <div className="grid-view-fullscreen">
      <div className="grid-view-scroll">
        <table className="structure-grid">
          <thead>
            <tr>
              <th className="row-header corner"></th>
              {Array.from({ length: maxDisplayCols }, (_, i) => (
                <th key={i} className="col-header">{getColumnLetter(i)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxDisplayRows }, (_, rowIdx) => (
              <tr key={rowIdx}>
                <td className="row-header">{rowIdx + 1}</td>
                {Array.from({ length: maxDisplayCols }, (_, colIdx) => {
                  const { type, content } = getCellContent(rowIdx, colIdx)
                  return (
                    <td 
                      key={colIdx} 
                      className={`grid-cell ${type}`}
                      title={`${getColumnLetter(colIdx)}${rowIdx + 1}${content ? `: ${content}` : ''}`}
                    >
                      <div className="cell-content">
                        {type === 'numeric' ? (
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
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-info">
        {sheet.rows} rows × {sheet.cols} columns
      </div>
    </div>
  )
}

interface SummaryViewProps {
  sheet: SheetStructure
}

function SummaryView({ sheet }: SummaryViewProps) {
  const headersArray = Object.entries(sheet.headers || {}).sort((a, b) => {
    const colA = a[0].replace(/\d+/g, '')
    const colB = b[0].replace(/\d+/g, '')
    return colA.localeCompare(colB)
  })

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
              headersArray.map(([cell, header]) => (
                <span key={cell} className="structure-tag header-tag">
                  <span className="tag-cell">{cell}</span>
                  {header}
                </span>
              ))
            ) : (
              <span className="no-data">No headers detected</span>
            )}
          </div>
        </div>

        {rowLabelsArray.length > 0 && (
          <div className="summary-card wide">
            <h3><Table size={16} /> Row Labels</h3>
            <div className="tags-container">
              {rowLabelsArray.map(([cell, label]) => (
                <span key={cell} className="structure-tag row-tag">
                  <span className="tag-cell">{cell}</span>
                  {label}
                </span>
              ))}
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
              {Object.entries(sheet.formulas).slice(0, 20).map(([cell, formula]) => (
                <div key={cell} className="formula-row">
                  <span className="formula-cell">{cell}</span>
                  <code className="formula-code">{formula}</code>
                </div>
              ))}
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