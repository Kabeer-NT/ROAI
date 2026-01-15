import { useState, useEffect, useCallback } from 'react'
import type { Message, SpreadsheetFile, ToolCall, WebSource, ChatResponse, Followup } from '../types'
import { useAuth } from './useAuth'

export { useAuth, AuthProvider } from './useAuth'
export { useFileHandle } from './useFileHandle'
export { useTheme } from './useTheme'
export { useVisibility } from './useVisibility'
export type { FileHandleEntry } from './useFileHandle'
export type { 
  VisibilityState, 
  SerializedVisibility,
  SheetVisibilityState,
  FileVisibilityState,
  SerializedSheetVisibility,
  SerializedFileVisibility,
} from './useVisibility'

export function useModels() {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          setModels(data.models)
          setSelectedModel(data.default)
          setLoaded(true)
        }
      })
      .catch(() => {})
  }, [loaded])

  return { models, selectedModel, setSelectedModel }
}

// ============================================================================
// Upload Response
// ============================================================================

interface UploadResponse {
  file_id: string
  filename: string
  sheets: Array<{ name: string; rows: number; columns: number }>
}

export function useSpreadsheets() {
  const { token } = useAuth()
  const [files, setFiles] = useState<SpreadsheetFile[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const uploadFile = useCallback(async (file: File): Promise<SpreadsheetFile | null> => {
    if (!token) return null
    
    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      
      const data: UploadResponse = await res.json()
      const newFile: SpreadsheetFile = {
        id: data.file_id || Date.now().toString(),
        filename: data.filename,
        sheets: data.sheets,
        uploadedAt: new Date(),
      }
      setFiles(prev => [...prev, newFile])
      
      return newFile
    } catch {
      return null
    } finally {
      setIsUploading(false)
    }
  }, [token])

  const reuploadFile = useCallback(async (id: string, file: File): Promise<SpreadsheetFile | null> => {
    if (!token) return null
    
    const formData = new FormData()
    formData.append('file', file)

    try {
      await fetch(`/api/spreadsheet/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      
      const data: UploadResponse = await res.json()
      const updatedFile: SpreadsheetFile = {
        id: data.file_id || id,
        filename: data.filename,
        sheets: data.sheets,
        uploadedAt: new Date(),
      }
      
      setFiles(prev => prev.map(f => f.id === id ? updatedFile : f))
      
      return updatedFile
    } catch {
      return null
    }
  }, [token])

  const removeFile = useCallback(async (id: string) => {
    if (!token) return
    await fetch(`/api/spreadsheet/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    setFiles(prev => prev.filter(f => f.id !== id))
  }, [token])

  const clearAll = useCallback(async () => {
    if (!token) return
    await fetch('/api/spreadsheet', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    setFiles([])
  }, [token])

  return { 
    files, 
    setFiles, 
    isUploading, 
    uploadFile, 
    reuploadFile, 
    removeFile, 
    clearAll,
  }
}

// ============================================================================
// Visibility type for API calls - SHEET-SCOPED
// ============================================================================

interface SerializedSheetVisibility {
  hiddenColumns: string[]
  hiddenRows: number[]
  hiddenCells: string[]
  visibleColumns?: string[]
  visibleRows?: number[]
  visibleCells?: string[]
}

interface SerializedFileVisibility {
  [sheetName: string]: SerializedSheetVisibility
}

interface UseChatOptions {
  getAllSerializedVisibility?: () => Record<string, SerializedFileVisibility>
}

// ============================================================================
// useChat Hook - Updated for sources and better error handling
// ============================================================================

export function useChat(
  selectedModel: string, 
  _files: SpreadsheetFile[],
  options?: UseChatOptions
) {
  const { token } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading || !token) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    try {
      // Get visibility settings if available
      const visibility = options?.getAllSerializedVisibility?.()
      const hasVisibility = visibility && Object.keys(visibility).length > 0

      const requestBody = {
        messages: [...messages, userMessage]
          .filter(m => !m.content.startsWith('📊') && !m.content.startsWith('❌') && !m.content.startsWith('🔄'))
          .map(m => ({ role: m.role, content: m.content })),
        model: selectedModel,
        include_followups: true,
        ...(hasVisibility && { visibility }),
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      })

      const data: ChatResponse = await res.json()
      
      // Check for error in response (backend now returns 200 with error field)
      if (data.error) {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.error.message || 'Something went wrong. Please try again.',
          timestamp: new Date(),
          // Include error suggestions as followups
          followups: data.error.suggestions?.map(s => ({ text: s, type: 'followup' as const })),
        }
        setMessages(prev => [...prev, errorMessage])
        return
      }
      
      if (!res.ok) {
        throw new Error((data as any).detail || 'Request failed')
      }
      
      // Extract tool calls with sources
      const toolCalls: ToolCall[] = (data.tool_calls || []).map(tc => {
        // Debug: log what we're receiving
        console.log('Tool call from backend:', tc)
        return {
          ...tc,
          sources: tc.sources || []
        }
      })
      
      // Debug: log the processed tool calls
      if (toolCalls.length > 0) {
        console.log('Processed tool calls with sources:', toolCalls)
      }
      
      // Normalize followups to Followup[] format
      const followups: Followup[] | undefined = data.followups?.map(f => 
        typeof f === 'string' ? { text: f, type: 'followup' as const } : f
      )
      
      // Collect all sources (from tool calls + top-level)
      const allSources: WebSource[] = [
        ...(data.sources || []),
        ...toolCalls.flatMap(tc => tc.sources || [])
      ]
      
      // Deduplicate sources by URL
      const uniqueSources = allSources.reduce((acc, source) => {
        if (!acc.find(s => s.url === source.url)) {
          acc.push(source)
        }
        return acc
      }, [] as WebSource[])
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        followups: followups && followups.length > 0 ? followups : undefined,
        sources: uniqueSources.length > 0 ? uniqueSources : undefined,
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Something went wrong: ${error}`,
        timestamp: new Date(),
        followups: [
          { text: 'Try asking again', type: 'followup' },
          { text: 'Ask a simpler question', type: 'followup' }
        ]
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }, [messages, selectedModel, isLoading, token, options])

  const addSystemMessage = useCallback((content: string) => {
    const msg: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, msg])
  }, [])

  const clearMessages = useCallback(() => setMessages([]), [])

  return { messages, isLoading, sendMessage, addSystemMessage, clearMessages }
}