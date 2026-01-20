import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MessageSquare, LayoutGrid, ChevronLeft, ChevronRight, Hexagon } from 'lucide-react'
import {
  Sidebar,
  ChatMessage,
  LoadingMessage,
  ChatInput,
  Welcome,
  ToastContainer,
  useToast,
  WorkspacePanel,
} from '../components'
import type { SelectionRange, Message, SpreadsheetFile, ToolCall, WebSource } from '../types'
import {
  useModels,
  useFileHandle,
  useTheme,
  useVisibility,
  useAuth,
} from '../hooks'
import { useConversations } from '../hooks/useConversations'

type ViewMode = 'reference' | 'work'

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { token } = useAuth()
  const { theme, toggleTheme } = useTheme()

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('reference')
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [selectionContext, setSelectionContext] = useState<SelectionRange | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Resizable divider
  const [workspaceWidth, setWorkspaceWidth] = useState(60)
  const isDragging = useRef(false)
  const contentAreaRef = useRef<HTMLDivElement>(null)

  // Models
  const { models, selectedModel, setSelectedModel } = useModels()

  // Conversation
  const {
    activeConversation,
    isLoading: conversationLoading,
    loadConversation,
  } = useConversations()

  // Visibility - per file
  const {
    getFileVisibility,
    setFileVisibility,
    getAllSerializedVisibility,
    clearVisibility,
    stats: visibilityStats,
  } = useVisibility()

  // File handles for auto-reload
  const fileHandleMap = useRef<Map<string, string>>(new Map())
  const {
    isSupported: fileSystemSupported,
    isReloading,
    storeHandle,
    removeHandle,
    openMultipleFiles,
  } = useFileHandle({
    onFileReloaded: async (handleId, file) => {
      // Find the file_id for this handle
      const fileId = Array.from(fileHandleMap.current.entries())
        .find(([fid, hid]) => hid === handleId)?.[0]
      if (fileId && activeConversation) {
        await handleReuploadFile(fileId, file)
      }
    },
  })

  const { toasts, addToast, dismissToast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  // Optimistic UI for pending message
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(null)

  // Load conversation on mount or ID change
  useEffect(() => {
    if (conversationId) {
      const id = parseInt(conversationId, 10)
      if (!isNaN(id)) {
        loadConversation(id).then(conv => {
          if (!conv) {
            // Conversation not found, redirect back
            navigate('/conversations')
          }
        })
      }
    }
  }, [conversationId, loadConversation, navigate])

  // Convert conversation messages to UI messages
  const conversationMessages: Message[] = useMemo(() => {
    if (!activeConversation) return []

    return activeConversation.messages.map(m => ({
      id: m.id.toString(),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at),
      toolCalls: m.tool_calls as ToolCall[] | undefined,
      sources: m.sources as WebSource[] | undefined,
      followups: m.followups?.map(f => ({ text: f, type: 'followup' as const })),
    }))
  }, [activeConversation])

  // Combine with pending message for display
  const messages: Message[] = useMemo(() => {
    if (pendingUserMessage) {
      return [...conversationMessages, pendingUserMessage]
    }
    return conversationMessages
  }, [conversationMessages, pendingUserMessage])

  // Files scoped to this conversation
  const files: SpreadsheetFile[] = useMemo(() => {
    if (!activeConversation?.files) return []

    return activeConversation.files.map(f => ({
      id: f.file_id,
      filename: f.filename,
      sheets: (f as any).sheets || [],
      uploadedAt: new Date(f.added_at),
    }))
  }, [activeConversation])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Show suggestions when files exist but no messages
  useEffect(() => {
    if (files.length > 0 && !showSuggestions && messages.length === 0) {
      const timer = setTimeout(() => setShowSuggestions(true), 500)
      return () => clearTimeout(timer)
    }
    if (files.length === 0) {
      setShowSuggestions(false)
    }
  }, [files.length, showSuggestions, messages.length])

  // Auto-expand chat when selection context set
  useEffect(() => {
    if (selectionContext && chatCollapsed) {
      setChatCollapsed(false)
    }
  }, [selectionContext, chatCollapsed])

  // Resizable divider handlers
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !contentAreaRef.current) return
      const rect = contentAreaRef.current.getBoundingClientRect()
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100
      setWorkspaceWidth(Math.min(80, Math.max(30, newWidth)))
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Send message
  const sendMessage = useCallback(async (content: string, selContext?: SelectionRange) => {
    if (!content.trim() || isLoading || !token || !activeConversation) return

    // Optimistic UI: show user message immediately
    const optimisticUserMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }
    setPendingUserMessage(optimisticUserMessage)
    setIsLoading(true)

    try {
      const visibility = getAllSerializedVisibility()
      const hasVisibility = visibility && Object.keys(visibility).length > 0

      const selection_context = selContext ? {
        sheetName: selContext.sheetName,
        startCell: selContext.startCell,
        endCell: selContext.endCell,
        cells: selContext.cells,
        rangeString: selContext.rangeString,
      } : undefined

      const requestBody = {
        messages: [
          ...conversationMessages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: content.trim() }
        ],
        model: selectedModel,
        conversation_id: activeConversation.id,
        include_followups: true,
        ...(hasVisibility && { visibility }),
        ...(selection_context && { selection_context }),
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      })

      await res.json()

      // Clear pending message before reload
      setPendingUserMessage(null)

      // Reload conversation to get updated messages
      await loadConversation(activeConversation.id)

    } catch (error) {
      console.error('Chat error:', error)
      addToast('Failed to send message', 'error')
      setPendingUserMessage(null)
    } finally {
      setIsLoading(false)
      setSelectionContext(null)
    }
  }, [token, conversationMessages, selectedModel, activeConversation, getAllSerializedVisibility, loadConversation, addToast, isLoading])

  // Upload file to conversation
  const handleUploadFile = useCallback(async (file: File, handle?: FileSystemFileHandle) => {
    if (!token || !activeConversation) return null

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/upload?conversation_id=${activeConversation.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) throw new Error('Upload failed')

      const data = await res.json()

      // Store handle for auto-reload if provided
      if (handle) {
        const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
        storeHandle(handleId, handle, file.name, file.lastModified)
        fileHandleMap.current.set(data.file_id, handleId)
      }

      // Reload conversation to get updated files
      await loadConversation(activeConversation.id)

      addToast(`✅ Loaded ${data.filename}`, 'success')
      return data
    } catch (err) {
      addToast(`❌ Failed to upload ${file.name}`, 'error')
      return null
    } finally {
      setIsUploading(false)
    }
  }, [token, activeConversation, storeHandle, loadConversation, addToast])

  // Reupload file (for auto-reload)
  const handleReuploadFile = useCallback(async (fileId: string, file: File) => {
    if (!token || !activeConversation) return

    const formData = new FormData()
    formData.append('file', file)

    try {
      // Delete old and upload new
      await fetch(`/api/spreadsheet/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      const res = await fetch(`/api/upload?conversation_id=${activeConversation.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })

      if (res.ok) {
        await loadConversation(activeConversation.id)
        addToast(`🔄 Reloaded ${file.name}`, 'info')
      }
    } catch (err) {
      console.error('Reupload error:', err)
    }
  }, [token, activeConversation, loadConversation, addToast])

  // File picker using File System Access API
  const handleFilePickerOpen = useCallback(async () => {
    if (!fileSystemSupported || !activeConversation) return false

    try {
      const results = await openMultipleFiles()
      if (results.length === 0) return true

      for (const { file, handle } of results) {
        const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
        if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
          addToast(`❌ ${file.name} is not supported`, 'error')
          continue
        }

        await handleUploadFile(file, handle)
      }

      return true
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('File picker error:', err)
      }
      return false
    }
  }, [fileSystemSupported, activeConversation, openMultipleFiles, handleUploadFile, addToast])

  // Handle files from drag/drop or input
  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
      if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
        addToast(`❌ ${file.name} is not supported`, 'error')
        continue
      }
      await handleUploadFile(file)
    }
  }, [handleUploadFile, addToast])

  // Remove file from conversation
  const handleFileRemove = useCallback(async (fileId: string) => {
    if (!token || !activeConversation) return

    const file = files.find(f => f.id === fileId)

    try {
      // Remove from conversation
      await fetch(`/api/conversations/${activeConversation.id}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      // Clean up handle if exists
      const handleId = fileHandleMap.current.get(fileId)
      if (handleId) {
        removeHandle(handleId)
        fileHandleMap.current.delete(fileId)
      }

      // Clear visibility
      if (file) {
        clearVisibility(file.filename)
      }

      // Reload conversation
      await loadConversation(activeConversation.id)

      addToast('File removed', 'info')
    } catch (err) {
      addToast('Failed to remove file', 'error')
    }
  }, [token, activeConversation, files, removeHandle, clearVisibility, loadConversation, addToast])

  // Navigation
  const handleBackToConversations = useCallback(() => {
    navigate('/conversations')
  }, [navigate])

  // Click handlers
  const handleHintClick = useCallback((hint: string) => {
    sendMessage(hint)
    setShowSuggestions(false)
  }, [sendMessage])

  const handleFollowupClick = useCallback((text: string) => {
    sendMessage(text)
  }, [sendMessage])

  const handleAskAI = useCallback((selection: SelectionRange) => {
    setSelectionContext(selection)
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectionContext(null)
  }, [])

  const handleSendMessage = useCallback((message: string, context?: SelectionRange) => {
    sendMessage(message, context)
  }, [sendMessage])

  // Derived state
  const hasMessages = messages.length > 0
  const hasFiles = files.length > 0

  // Auto-select first file
  useEffect(() => {
    if (files.length > 0 && !activeFileId) {
      setActiveFileId(files[0].id)
    } else if (files.length === 0) {
      setActiveFileId(null)
    } else if (activeFileId && !files.find(f => f.id === activeFileId)) {
      setActiveFileId(files[0]?.id || null)
    }
  }, [files, activeFileId])

  const activeFile = files.find(f => f.id === activeFileId) || null
  const showCollapsedChat = viewMode === 'work' && chatCollapsed

  // Loading state
  if (conversationLoading && !activeConversation) {
    return (
      <div className="app" data-theme={theme}>
        <div className="loading-screen">
          <Hexagon size={48} className="spinning" />
          <p>Loading conversation...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app" data-theme={theme}>
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        files={files}
        onFileRemove={handleFileRemove}
        onFilesAdd={handleFilesAdd}
        onFilePickerOpen={fileSystemSupported ? handleFilePickerOpen : undefined}
        isUploading={isUploading}
        isReloading={isReloading}
        theme={theme}
        onThemeToggle={toggleTheme}
        getFileVisibility={getFileVisibility}
        setFileVisibility={setFileVisibility}
        visibilityStats={visibilityStats}
        conversationTitle={activeConversation?.title}
        onBackClick={handleBackToConversations}
      />

      <main className={`main ${viewMode === 'work' ? 'work-mode' : 'reference-mode'}`}>
        {/* Mode Toggle */}
        {hasFiles && (
          <div className="mode-toggle-bar">
            <div className="mode-toggle">
              <button
                className={`mode-btn ${viewMode === 'reference' ? 'active' : ''}`}
                onClick={() => setViewMode('reference')}
              >
                <MessageSquare size={16} />
                <span>Chat</span>
              </button>
              <button
                className={`mode-btn ${viewMode === 'work' ? 'active' : ''}`}
                onClick={() => setViewMode('work')}
              >
                <LayoutGrid size={16} />
                <span>Cowork</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="content-area" ref={contentAreaRef}>
          {viewMode === 'work' && activeFile && (
            <>
              <div
                className={`workspace-panel ${showCollapsedChat ? 'expanded' : ''}`}
                style={{
                  flex: showCollapsedChat ? 1 : `0 0 ${workspaceWidth}%`,
                  maxWidth: showCollapsedChat ? 'none' : `${workspaceWidth}%`
                }}
              >
                <WorkspacePanel
                  file={activeFile}
                  files={files}
                  onFileSelect={setActiveFileId}
                  fileVisibility={getFileVisibility(activeFile.filename)}
                  onFileVisibilityChange={(vis) => setFileVisibility(activeFile.filename, vis)}
                  onAskAI={handleAskAI}
                />
              </div>

              {!showCollapsedChat && (
                <div className="panel-divider" onMouseDown={handleDividerMouseDown}>
                  <div className="divider-handle" />
                </div>
              )}
            </>
          )}

          {showCollapsedChat ? (
            <div className="chat-panel-collapsed">
              <button className="chat-expand-btn" onClick={() => setChatCollapsed(false)}>
                <ChevronLeft size={18} />
              </button>
              <div className="chat-collapsed-icon">
                <Hexagon size={24} />
              </div>
              <span className="chat-collapsed-label">R-O-AI</span>
              {messages.length > 0 && (
                <span className="chat-collapsed-badge">{messages.length}</span>
              )}
            </div>
          ) : (
            <div
              className={`chat-panel ${viewMode === 'work' ? 'narrow' : 'full'}`}
              style={viewMode === 'work' ? {
                flex: `0 0 ${100 - workspaceWidth}%`,
                maxWidth: `${100 - workspaceWidth}%`,
                minWidth: '280px'
              } : undefined}
            >
              {viewMode === 'work' && (
                <button className="chat-collapse-btn" onClick={() => setChatCollapsed(true)}>
                  <ChevronRight size={18} />
                </button>
              )}

              <div className="chat-area">
                {!hasMessages ? (
                  <Welcome
                    onHintClick={handleHintClick}
                    hasFiles={hasFiles}
                    showSuggestions={showSuggestions}
                  />
                ) : (
                  <div className="messages">
                    {messages.map((message, idx) => (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        onFollowupClick={handleFollowupClick}
                        isLatest={idx === messages.length - 1 && message.role === 'assistant'}
                        disabled={isLoading}
                      />
                    ))}
                    {isLoading && <LoadingMessage />}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              <div className="input-container">
                <ChatInput
                  onSend={handleSendMessage}
                  onFilesAdd={handleFilesAdd}
                  onFilePickerOpen={fileSystemSupported ? handleFilePickerOpen : undefined}
                  disabled={isLoading}
                  hasFiles={hasFiles}
                  selectionContext={selectionContext}
                  onClearSelection={handleClearSelection}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}