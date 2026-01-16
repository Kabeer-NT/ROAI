// ============================================================================
// Core Types
// ============================================================================

/**
 * Web source citation from search results
 */
export interface WebSource {
  url: string
  title: string
  snippet: string
}

/**
 * Tool call made during chat processing
 */
export interface ToolCall {
  type: 'formula' | 'pandas' | 'web_search'
  formula?: string
  code?: string
  query?: string
  sheet?: string
  result: any
  sources?: WebSource[]  // Sources from web_search type
}

/**
 * Follow-up suggestion
 */
export interface Followup {
  text: string
  type?: 'followup' | 'drill_down' | 'compare' | 'explore'
}

/**
 * Chat message
 */
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
  followups?: Followup[]
  sources?: WebSource[]  // Top-level sources for easy access
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
// Selection Types (for Ask R-O-AI feature)
// ============================================================================

/**
 * Selection range from StructureViewer when user selects cells
 */
export interface SelectionRange {
  sheetName: string
  startCell: string
  endCell: string
  cells: string[]
  rangeString: string // e.g., "A1:B5" or "A1" for single cell
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
  type: string
  icon?: string
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
  model: string
  conversation_id?: number
  tool_calls?: ToolCall[]
  followups?: Followup[] | string[]
  sources?: WebSource[]  // Top-level sources
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