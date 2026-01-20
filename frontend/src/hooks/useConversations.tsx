import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'

// =============================================================================
// Types
// =============================================================================

export interface ConversationFile {
  file_id: string
  filename: string
  visibility_state: Record<string, any> | null
  added_at: string
}

export interface ConversationMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls?: any[]
  sources?: any[]
  followups?: string[]
  selection_context?: any
  created_at: string
}

export interface ConversationSummary {
  id: number
  title: string
  model: string | null
  message_count: number
  file_count: number
  created_at: string
  updated_at: string
}

export interface ConversationDetail {
  id: number
  title: string
  model: string | null
  messages: ConversationMessage[]
  files: ConversationFile[]
  created_at: string
  updated_at: string
}

// =============================================================================
// Hook
// =============================================================================

export function useConversations() {
  const { token } = useAuth()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversation, setActiveConversation] = useState<ConversationDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch all conversations
  const fetchConversations = useCallback(async () => {
    if (!token) return
    
    setIsLoading(true)
    setError(null)
    
    try {
      const res = await fetch('/api/conversations', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (!res.ok) throw new Error('Failed to fetch conversations')
      
      const data = await res.json()
      setConversations(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  // Load on mount
  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  // Create a new conversation
  const createConversation = useCallback(async (
    title?: string,
    model?: string,
    fileIds?: string[]
  ): Promise<ConversationDetail | null> => {
    if (!token) return null
    
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          title: title || 'New Conversation',
          model,
          file_ids: fileIds
        })
      })
      
      if (!res.ok) throw new Error('Failed to create conversation')
      
      const conv: ConversationDetail = await res.json()
      
      // Add to list
      setConversations(prev => [{
        id: conv.id,
        title: conv.title,
        model: conv.model,
        message_count: 0,
        file_count: conv.files.length,
        created_at: conv.created_at,
        updated_at: conv.updated_at
      }, ...prev])
      
      setActiveConversation(conv)
      return conv
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return null
    }
  }, [token])

  // Load a specific conversation
  const loadConversation = useCallback(async (conversationId: number): Promise<ConversationDetail | null> => {
    if (!token) return null
    
    setIsLoading(true)
    setError(null)
    
    try {
      // First, load the conversation files into memory
      const loadRes = await fetch(`/api/chat/load/${conversationId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      // If the conversation doesn't exist, handle gracefully
      if (loadRes.status === 404) {
        console.warn(`Conversation ${conversationId} not found, clearing active`)
        setActiveConversation(null)
        // Remove from conversations list if it's there
        setConversations(prev => prev.filter(c => c.id !== conversationId))
        return null
      }
      
      // Then get the full conversation detail
      const res = await fetch(`/api/conversations/${conversationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 404) {
        console.warn(`Conversation ${conversationId} not found, clearing active`)
        setActiveConversation(null)
        setConversations(prev => prev.filter(c => c.id !== conversationId))
        return null
      }
      
      if (!res.ok) throw new Error('Failed to load conversation')
      
      const conv: ConversationDetail = await res.json()
      setActiveConversation(conv)
      return conv
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setActiveConversation(null)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [token])

  // Update conversation (title, model)
  const updateConversation = useCallback(async (
    conversationId: number,
    updates: { title?: string; model?: string }
  ): Promise<boolean> => {
    if (!token) return false
    
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      })
      
      if (!res.ok) throw new Error('Failed to update conversation')
      
      const updated = await res.json()
      
      // Update in list
      setConversations(prev => prev.map(c => 
        c.id === conversationId ? { ...c, ...updates, updated_at: updated.updated_at } : c
      ))
      
      // Update active if it's the same
      if (activeConversation?.id === conversationId) {
        setActiveConversation(prev => prev ? { ...prev, ...updates } : null)
      }
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [token, activeConversation])

  // Delete conversation
  const deleteConversation = useCallback(async (conversationId: number): Promise<boolean> => {
    if (!token) return false
    
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (!res.ok) throw new Error('Failed to delete conversation')
      
      // Remove from list
      setConversations(prev => prev.filter(c => c.id !== conversationId))
      
      // Clear active if it was deleted
      if (activeConversation?.id === conversationId) {
        setActiveConversation(null)
      }
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [token, activeConversation])

  // Add file to conversation
  const addFileToConversation = useCallback(async (
    conversationId: number,
    fileId: string
  ): Promise<boolean> => {
    if (!token) return false
    
    try {
      const res = await fetch(`/api/conversations/${conversationId}/files/${fileId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (!res.ok) throw new Error('Failed to add file')
      
      // Refresh conversation
      await loadConversation(conversationId)
      
      // Update file count in list
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, file_count: c.file_count + 1 } : c
      ))
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [token, loadConversation])

  // Remove file from conversation
  const removeFileFromConversation = useCallback(async (
    conversationId: number,
    fileId: string
  ): Promise<boolean> => {
    if (!token) return false
    
    try {
      const res = await fetch(`/api/conversations/${conversationId}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (!res.ok) throw new Error('Failed to remove file')
      
      // Update active conversation
      if (activeConversation?.id === conversationId) {
        setActiveConversation(prev => prev ? {
          ...prev,
          files: prev.files.filter(f => f.file_id !== fileId)
        } : null)
      }
      
      // Update file count in list
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, file_count: Math.max(0, c.file_count - 1) } : c
      ))
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [token, activeConversation])

  // Update visibility state for a file in conversation
  const updateFileVisibility = useCallback(async (
    conversationId: number,
    fileId: string,
    visibilityState: Record<string, any>
  ): Promise<boolean> => {
    if (!token) return false
    
    try {
      const res = await fetch(`/api/conversations/${conversationId}/visibility`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file_id: fileId,
          visibility_state: visibilityState
        })
      })
      
      if (!res.ok) throw new Error('Failed to update visibility')
      
      // Update active conversation
      if (activeConversation?.id === conversationId) {
        setActiveConversation(prev => prev ? {
          ...prev,
          files: prev.files.map(f =>
            f.file_id === fileId ? { ...f, visibility_state: visibilityState } : f
          )
        } : null)
      }
      
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    }
  }, [token, activeConversation])

  // Add a message to active conversation (used after chat response)
  const addMessageToActive = useCallback((message: ConversationMessage) => {
    setActiveConversation(prev => {
      if (!prev) return null
      return {
        ...prev,
        messages: [...prev.messages, message]
      }
    })
    
    // Update message count in list
    if (activeConversation) {
      setConversations(prev => prev.map(c =>
        c.id === activeConversation.id 
          ? { ...c, message_count: c.message_count + 1, updated_at: new Date().toISOString() }
          : c
      ))
    }
  }, [activeConversation])

  // Clear active conversation (start new)
  const clearActive = useCallback(() => {
    setActiveConversation(null)
  }, [])

  return {
    // State
    conversations,
    activeConversation,
    isLoading,
    error,
    
    // Actions
    fetchConversations,
    createConversation,
    loadConversation,
    updateConversation,
    deleteConversation,
    addFileToConversation,
    removeFileFromConversation,
    updateFileVisibility,
    addMessageToActive,
    clearActive,
    setActiveConversation,
  }
}