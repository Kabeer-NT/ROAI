export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
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
}

export type ConnectionStatus = 'checking' | 'connected' | 'error'
