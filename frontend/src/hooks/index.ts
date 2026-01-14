import { useState, useEffect, useCallback } from 'react'
import type { Message, SpreadsheetFile, ToolCall } from '../types'
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
      
      const data = await res.json()
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
      
      const data = await res.json()
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

  return { files, setFiles, isUploading, uploadFile, reuploadFile, removeFile, clearAll }
}

// ============================================================================
// Visibility type for API calls - NOW SHEET-SCOPED
// ============================================================================

/**
 * NEW format - sheet-scoped visibility:
 * {
 *   "filename.xlsx": {
 *     "Sheet1": { hiddenColumns: [...], hiddenRows: [...], hiddenCells: [...] },
 *     "Sheet2": { ... }
 *   }
 * }
 */
interface SerializedSheetVisibility {
  hiddenColumns: string[]
  hiddenRows: number[]
  hiddenCells: string[]
}

interface SerializedFileVisibility {
  [sheetName: string]: SerializedSheetVisibility
}

interface UseChatOptions {
  getAllSerializedVisibility?: () => Record<string, SerializedFileVisibility>
}

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

      // DEBUG: Log what we're sending to the backend
      console.group('🔒 Visibility Debug (Sheet-Scoped)')
      console.log('getAllSerializedVisibility function exists:', !!options?.getAllSerializedVisibility)
      console.log('Raw visibility data:', visibility)
      console.log('Has visibility items:', hasVisibility)
      if (hasVisibility) {
        Object.entries(visibility).forEach(([filename, fileVis]) => {
          console.log(`📁 File: ${filename}`)
          Object.entries(fileVis).forEach(([sheetName, sheetVis]) => {
            console.log(`  📋 Sheet: ${sheetName}`)
            console.log(`    Hidden columns: ${sheetVis.hiddenColumns.join(', ') || 'none'}`)
            console.log(`    Hidden rows: ${sheetVis.hiddenRows.join(', ') || 'none'}`)
            console.log(`    Hidden cells: ${sheetVis.hiddenCells.join(', ') || 'none'}`)
          })
        })
      }
      console.groupEnd()

      const requestBody = {
        messages: [...messages, userMessage]
          .filter(m => !m.content.startsWith('📊') && !m.content.startsWith('❌') && !m.content.startsWith('🔄'))
          .map(m => ({ role: m.role, content: m.content })),
        model: selectedModel,
        ...(hasVisibility && { visibility }),
      }

      // DEBUG: Log the full request body
      console.log('📤 Full request body being sent:', JSON.stringify(requestBody, null, 2))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      })

      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.detail || 'Request failed')
      }
      
      const toolCalls: ToolCall[] = data.tool_calls || []
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }
      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error}`,
        timestamp: new Date(),
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