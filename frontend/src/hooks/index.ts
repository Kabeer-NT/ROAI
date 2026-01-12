import { useState, useEffect, useCallback } from 'react'
import type { Message, SpreadsheetFile, ConnectionStatus } from '../types'
import { useAuth } from './useAuth'

export { useAuth, AuthProvider } from './useAuth'
export { useFileHandle } from './useFileHandle'
export type { FileHandleEntry } from './useFileHandle'

export function useModels() {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('checking')

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setStatus('error')
        } else {
          setModels(data.models)
          setSelectedModel(data.default)
          setStatus('connected')
        }
      })
      .catch(() => setStatus('error'))
  }, [])

  return { models, selectedModel, setSelectedModel, status }
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

export function useChat(selectedModel: string, _files: SpreadsheetFile[]) {
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          messages: [...messages, userMessage]
            .filter(m => !m.content.startsWith('📊') && !m.content.startsWith('❌') && !m.content.startsWith('🔄'))
            .map(m => ({ role: m.role, content: m.content })),
          model: selectedModel,
        }),
      })

      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.detail || 'Request failed')
      }
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
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
  }, [messages, selectedModel, isLoading, token])

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