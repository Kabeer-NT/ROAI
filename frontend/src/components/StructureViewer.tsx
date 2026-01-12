import { useState, useEffect } from 'react'
import { X, Table, FileSpreadsheet, Hash, Type, Calculator, Grid, Eye, EyeOff, Shield } from 'lucide-react'
import { useAuth } from '../hooks'

interface SheetStructure {
  rows: number
  cols: number
  headers: Record<string, string>  // cell_addr -> header text
  row_labels: Record<string, string>  // cell_addr -> label text
  text_values?: Record<string, string>  // cell_addr -> ALL text values
  formulas: Record<string, string>
  cell_type_counts: Record<string, number>
  cell_types?: Record<string, string>  // cell_addr -> type
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

  if (!isOpen) return null

  const currentSheet = structure?.structures?.[activeSheet]

  return (
    <div className="structure-viewer-overlay" onClick={onClose}>
      <div className="structure-viewer" onClick={e => e.stopPropagation()}>
        <div className="structure-viewer-header">
          <div className="structure-viewer-title">
            <Shield size={20} className="shield-icon" />
            <span>What AI Sees: {filename}</span>
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
            <button className="structure-viewer-close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="structure-viewer-loading">Loading structure...</div>
        ) : structure?.structures ? (
          <>
            <div className="structure-tabs">
              {Object.keys(structure.structures).map(sheetName => (
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

            {currentSheet && viewMode === 'grid' && (
              <GridView sheet={currentSheet} sheetName={activeSheet} />
            )}

            {currentSheet && viewMode === 'summary' && (
              <SummaryView sheet={currentSheet} />
            )}

            <div className="structure-legend">
              <div className="legend-title"><Shield size={14} /> Cell Type Legend</div>
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

            <div className="structure-note security-note">
              <EyeOff size={16} />
              <div>
                <strong>Privacy Protection:</strong> Numeric values are completely hidden from the AI. 
                It can only see text labels, column headers, and formula structures — never your actual numbers.
              </div>
            </div>
          </>
        ) : (
          <div className="structure-viewer-error">
            Could not load structure. Try re-uploading the file.
          </div>
        )}
      </div>
    </div>
  )
}

interface GridViewProps {
  sheet: SheetStructure
  sheetName: string
}

function GridView({ sheet, sheetName }: GridViewProps) {
  const maxDisplayRows = Math.min(sheet.rows, 30)
  const maxDisplayCols = Math.min(sheet.cols, 15)

  // Build grid data
  const getColumnLetter = (idx: number): string => {
    let letter = ''
    while (idx >= 0) {
      letter = String.fromCharCode(65 + (idx % 26)) + letter
      idx = Math.floor(idx / 26) - 1
    }
    return letter
  }

  const getCellContent = (row: number, col: number): { type: string; content: string } => {
    const cellAddr = `${getColumnLetter(col)}${row + 1}`
    
    // Check if it's a header (from headers dict)
    if (sheet.headers && sheet.headers[cellAddr]) {
      return { type: 'header', content: sheet.headers[cellAddr] }
    }
    
    // Check if it's a formula
    if (sheet.formulas && sheet.formulas[cellAddr]) {
      return { type: 'formula', content: sheet.formulas[cellAddr] }
    }
    
    // Check cell type from cell_types if available
    if (sheet.cell_types?.[cellAddr]) {
      const cellType = sheet.cell_types[cellAddr]
      if (cellType === 'numeric') {
        return { type: 'numeric', content: '•••' }
      } else if (cellType === 'empty') {
        return { type: 'empty', content: '' }
      } else if (cellType === 'text') {
        // Get actual text value if available
        const textValue = sheet.text_values?.[cellAddr] || sheet.row_labels?.[cellAddr]
        return { type: 'text', content: textValue || '(text)' }
      } else if (cellType === 'header') {
        return { type: 'header', content: sheet.headers?.[cellAddr] || '(header)' }
      } else if (cellType === 'formula') {
        return { type: 'formula', content: sheet.formulas?.[cellAddr] || 'ƒx' }
      }
    }
    
    return { type: 'empty', content: '' }
  }

  return (
    <div className="grid-view-container">
      <div className="grid-view-scroll">
        <table className="structure-grid">
          <thead>
            <tr>
              <th className="row-header"></th>
              {Array.from({ length: maxDisplayCols }, (_, i) => (
                <th key={i} className="col-header">{getColumnLetter(i)}</th>
              ))}
              {sheet.cols > maxDisplayCols && <th className="col-header more">...</th>}
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
                      title={`${getColumnLetter(colIdx)}${rowIdx + 1}: ${type}${content ? ` - ${content}` : ''}`}
                    >
                      <div className="cell-content">
                        {type === 'numeric' ? (
                          <span className="hidden-value">
                            <EyeOff size={12} />
                          </span>
                        ) : type === 'formula' ? (
                          <span className="formula-indicator" title={content}>ƒx</span>
                        ) : (
                          <span className="cell-text">{content.slice(0, 15)}{content.length > 15 ? '…' : ''}</span>
                        )}
                      </div>
                    </td>
                  )
                })}
                {sheet.cols > maxDisplayCols && <td className="grid-cell more">...</td>}
              </tr>
            ))}
            {sheet.rows > maxDisplayRows && (
              <tr>
                <td className="row-header">...</td>
                {Array.from({ length: maxDisplayCols + (sheet.cols > maxDisplayCols ? 1 : 0) }, (_, i) => (
                  <td key={i} className="grid-cell more">...</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="grid-info">
        Showing {maxDisplayRows} of {sheet.rows} rows, {maxDisplayCols} of {sheet.cols} columns
      </div>
    </div>
  )
}

interface SummaryViewProps {
  sheet: SheetStructure
}

function SummaryView({ sheet }: SummaryViewProps) {
  // Convert headers object to array for display
  const headersArray = Object.entries(sheet.headers || {}).sort((a, b) => {
    // Sort by cell address
    const colA = a[0].replace(/\d+/g, '')
    const colB = b[0].replace(/\d+/g, '')
    return colA.localeCompare(colB)
  })

  const rowLabelsArray = Object.entries(sheet.row_labels || {}).slice(0, 15)

  return (
    <div className="structure-content">
      <div className="structure-meta">
        <span className="meta-item">
          <Hash size={14} />
          {sheet.rows} rows × {sheet.cols} cols
        </span>
      </div>

      <div className="structure-section">
        <h4><Type size={14} /> Headers (Column Names)</h4>
        <div className="structure-tags">
          {headersArray.length > 0 ? (
            headersArray.map(([cell, header]) => (
              <span key={cell} className="structure-tag header-tag">
                <span className="tag-col">{cell}:</span> {header}
              </span>
            ))
          ) : (
            <span className="no-data">No headers detected</span>
          )}
        </div>
      </div>

      {rowLabelsArray.length > 0 && (
        <div className="structure-section">
          <h4><Table size={14} /> Row Labels</h4>
          <div className="structure-tags">
            {rowLabelsArray.map(([cell, label]) => (
              <span key={cell} className="structure-tag row-tag">
                <span className="tag-row">{cell}:</span> {label}
              </span>
            ))}
            {Object.keys(sheet.row_labels || {}).length > 15 && (
              <span className="structure-tag more-tag">
                +{Object.keys(sheet.row_labels || {}).length - 15} more
              </span>
            )}
          </div>
        </div>
      )}

      {Object.keys(sheet.formulas || {}).length > 0 && (
        <div className="structure-section">
          <h4><Calculator size={14} /> Formulas</h4>
          <div className="structure-formulas">
            {Object.entries(sheet.formulas).slice(0, 10).map(([cell, formula]) => (
              <div key={cell} className="formula-item">
                <span className="formula-cell">{cell}</span>
                <code className="formula-code">{formula}</code>
              </div>
            ))}
            {Object.keys(sheet.formulas).length > 10 && (
              <div className="formula-item more">
                +{Object.keys(sheet.formulas).length - 10} more formulas
              </div>
            )}
          </div>
        </div>
      )}

      <div className="structure-section">
        <h4><Eye size={14} /> Cell Type Summary</h4>
        <div className="cell-type-summary">
          {Object.entries(sheet.cell_type_counts || {}).map(([type, count]) => (
            <div key={type} className="cell-type-item">
              <span className={`cell-type-dot ${type}`} />
              <span className="cell-type-name">{type}</span>
              <span className="cell-type-count">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}