// ============================================================================
// Core Types
// ============================================================================

export interface ToolCall {
  type: 'formula' | 'pandas' | 'web_search'
  formula?: string
  code?: string
  query?: string
  sheet?: string
  result: any
}

export interface Followup {
  text: string
  type?: 'followup' | 'drill_down' | 'compare' | 'explore'
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
  followups?: Followup[]  // NEW: Follow-up suggestions
}

export interface SheetInfo {
  name: string
  rows: number
  columns: number
  column_names?: string[]
}

export interface SpreadsheetFile {
  id: string
  filename: string
  sheets: SheetInfo[]
  uploadedAt: Date
}

// ============================================================================
// Enhanced Response Types (from backend)
// ============================================================================

export interface Insight {
  icon: string
  text: string
  type: 'count' | 'currency' | 'date' | 'category' | 'summary'
}

export interface QuickAction {
  id: string
  icon: string
  label: string
  query: string
  category?: string
}

export interface FriendlyError {
  type: 'friendly_error'
  icon: string
  message: string
  suggestions: string[]
}

export interface UploadResponse {
  success: boolean
  file_id: string
  filename: string
  sheets: SheetInfo[]
  instant_insights?: Insight[]
  quick_actions?: QuickAction[]
}

export interface ChatResponse {
  response: string
  tool_calls?: ToolCall[]
  followups?: Followup[] | string[]
  error?: FriendlyError
}

// ============================================================================
// Visibility Types
// ============================================================================

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