export interface ToolCall {
  type: 'formula' | 'pandas' | 'web_search'
  formula?: string
  code?: string
  query?: string
  sheet?: string
  result: any
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
}

export interface SheetStructure {
  name: string
  rows: number
  cols: number
  headers: string[]
  rowLabels: string[]
  formulas: Record<string, string>
  cellTypeCounts: Record<string, number>
}

export interface SpreadsheetStructure {
  file_id: string
  filename: string
  structures: Record<string, SheetStructure>
}

export interface SheetInfo {
  name: string
  rows: number
  columns: number
  column_names: string[]
}

export interface SpreadsheetFile {
  id: string
  filename: string
  sheets: SheetInfo[]
  uploadedAt: Date
  hasHandle?: boolean
}