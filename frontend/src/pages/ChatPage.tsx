import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
import { ConversationList } from '../components/ConversationList'
import type { SelectionRange, Message, SpreadsheetFile, ToolCall, WebSource } from '../types'
import {
  useModels,
  useSpreadsheets,
  useFileHandle,
  useTheme,
  useVisibility,
  useAuth,
} from '../hooks'
import { useConversations } from '../hooks/useConversations'

type ViewMode = 'reference' | 'work'

export function ChatPage() {
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
  
  // Conversations
  const {
    conversations,
    activeConversation,
    isLoading: conversationsLoading,
    loadConversation,
    updateConversation,
    deleteConversation,
    addFileToConversation,
    clearActive,
  } = useConversations()
  
  // Files (global user files)
  const {
    files: globalFiles,
    isUploading,
    uploadFile,
    reuploadFile,
    removeFile,
  } = useSpreadsheets()
  
  // Visibility - now per-conversation
  const {
    getFileVisibility,
    setFileVisibility,
    getAllSerializedVisibility,
    clearVisibility,
    stats: visibilityStats,
  } = useVisibility()
  
  // File handles
  const {
    isSupported: fileSystemSupported,
    isReloading,
    storeHandle,
    removeHandle,
    openMultipleFiles,
  } = useFileHandle({
    onFileReloaded: async (handleId, file) => {
      const fileId = fileHandleMap.current.get(handleId)
      if (fileId) {
        const result = await reuploadFile(fileId, file)
        if (result) {
          addToast(`🔄 Reloaded ${file.name}`, 'info')
        }
      }
    },
  })
  
  const { toasts, addToast, dismissToast } = useToast()
  const fileHandleMap = useRef<Map<string, string>>(new Map())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // ============================================================================
  // OPTIMISTIC UI: Pending message that shows immediately before backend responds
  // ============================================================================
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(null)
  
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
  
  // Combine conversation messages with pending message for display
  const messages: Message[] = useMemo(() => {
    if (pendingUserMessage) {
      return [...conversationMessages, pendingUserMessage]
    }
    return conversationMessages
  }, [conversationMessages, pendingUserMessage])
  
  // Files for this conversation (or global if no conversation)
  const conversationFiles: SpreadsheetFile[] = useMemo(() => {
    if (activeConversation?.files) {
      return activeConversation.files.map(f => ({
        id: f.file_id,
        filename: f.filename,
        sheets: [], // Will be populated from global files
        uploadedAt: new Date(f.added_at),
      }))
    }
    return globalFiles
  }, [activeConversation, globalFiles])
  
  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  // Show suggestions
  useEffect(() => {
    if (conversationFiles.length > 0 && !showSuggestions && messages.length === 0) {
      const timer = setTimeout(() => setShowSuggestions(true), 500)
      return () => clearTimeout(timer)
    }
    if (conversationFiles.length === 0) {
      setShowSuggestions(false)
    }
  }, [conversationFiles.length, showSuggestions, messages.length])
  
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
  
  // Send message with OPTIMISTIC UI
  const sendMessage = useCallback(async (content: string, selContext?: SelectionRange) => {
    if (!content.trim() || isLoading || !token) return
    
    // ========================================================================
    // OPTIMISTIC UI: Show user message immediately
    // ========================================================================
    const optimisticUserMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }
    setPendingUserMessage(optimisticUserMessage)
    setIsLoading(true)
    
    try {
      // Build request
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
        conversation_id: activeConversation?.id || null,
        include_followups: true,
        auto_create_conversation: !activeConversation, // Auto-create if no active conversation
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
      
      const data = await res.json()
      
      // Clear pending message before loading conversation (it will come from server)
      setPendingUserMessage(null)
      
      // If a new conversation was created, load it
      if (data.conversation_id && !activeConversation) {
        await loadConversation(data.conversation_id)
      } else if (activeConversation) {
        // Reload to get updated messages
        await loadConversation(activeConversation.id)
      }
      
    } catch (error) {
      console.error('Chat error:', error)
      addToast('Failed to send message', 'error')
      // Clear pending message on error
      setPendingUserMessage(null)
    } finally {
      setIsLoading(false)
      setSelectionContext(null)
    }
  }, [token, conversationMessages, selectedModel, activeConversation, getAllSerializedVisibility, loadConversation, addToast, isLoading])
  
  // File handlers
  const handleFilePickerOpen = useCallback(async () => {
    if (!fileSystemSupported) return false
    
    try {
      const results = await openMultipleFiles()
      if (results.length === 0) return true
      
      for (const { file, handle } of results) {
        const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
        if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
          addToast(`❌ ${file.name} is not supported`, 'error')
          continue
        }
        
        // Upload with conversation_id if we have one
        const url = activeConversation 
          ? `/api/upload?conversation_id=${activeConversation.id}`
          : '/api/upload'
        
        const formData = new FormData()
        formData.append('file', file)
        
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        })
        
        if (!res.ok) {
          addToast(`❌ Failed to upload ${file.name}`, 'error')
          continue
        }
        
        const data = await res.json()
        const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
        storeHandle(handleId, handle, file.name, file.lastModified)
        fileHandleMap.current.set(data.file_id, handleId)
        addToast(`✅ Loaded ${data.filename}`, 'success')
        
        // Reload conversation to get updated files
        if (activeConversation) {
          await loadConversation(activeConversation.id)
        }
      }
      
      return true
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('File picker error:', err)
      }
      return false
    }
  }, [fileSystemSupported, openMultipleFiles, token, activeConversation, storeHandle, addToast, loadConversation])
  
  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const result = await uploadFile(file)
      if (result) {
        addToast(`📊 ${file.name} loaded`, 'success')
        
        // If we have an active conversation, add the file to it
        if (activeConversation) {
          await addFileToConversation(activeConversation.id, result.id)
        }
      } else {
        addToast(`❌ Failed to upload ${file.name}`, 'error')
      }
    }
  }, [uploadFile, addToast, activeConversation, addFileToConversation])
  
  const handleFileRemove = useCallback((id: string) => {
    const file = globalFiles.find(f => f.id === id)
    const handleId = fileHandleMap.current.get(id)
    if (handleId) {
      removeHandle(handleId)
      fileHandleMap.current.delete(id)
    }
    if (file) {
      clearVisibility(file.filename)
    }
    removeFile(id)
  }, [globalFiles, removeFile, removeHandle, clearVisibility])
  
  // Conversation handlers
  const handleNewConversation = useCallback(() => {
    clearActive()
    setPendingUserMessage(null) // Clear any pending message
    setShowSuggestions(true)
  }, [clearActive])
  
  const handleSelectConversation = useCallback(async (id: number) => {
    setPendingUserMessage(null) // Clear any pending message when switching
    await loadConversation(id)
  }, [loadConversation])
  
  const handleDeleteConversation = useCallback(async (id: number) => {
    await deleteConversation(id)
  }, [deleteConversation])
  
  const handleRenameConversation = useCallback(async (id: number, title: string) => {
    await updateConversation(id, { title })
  }, [updateConversation])
  
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
  const hasFiles = conversationFiles.length > 0
  
  // Auto-select first file
  useEffect(() => {
    if (conversationFiles.length > 0 && !activeFileId) {
      setActiveFileId(conversationFiles[0].id)
    } else if (conversationFiles.length === 0) {
      setActiveFileId(null)
    } else if (activeFileId && !conversationFiles.find(f => f.id === activeFileId)) {
      setActiveFileId(conversationFiles[0]?.id || null)
    }
  }, [conversationFiles, activeFileId])
  
  const activeFile = globalFiles.find(f => f.id === activeFileId) || null
  const showCollapsedChat = viewMode === 'work' && chatCollapsed

  return (
    <div className="app" data-theme={theme}>
      {/* Sidebar with Conversation List */}
      <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : 'closed'}`}>
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          models={models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          files={globalFiles}
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
        />
        
        {/* Conversation List - Rendered separately below Sidebar content */}
        {sidebarOpen && (
          <div className="sidebar-conversations">
            <div className="section-label">Conversations</div>
            <ConversationList
              conversations={conversations}
              activeId={activeConversation?.id || null}
              onSelect={handleSelectConversation}
              onNew={handleNewConversation}
              onDelete={handleDeleteConversation}
              onRename={handleRenameConversation}
              isLoading={conversationsLoading}
            />
          </div>
        )}
      </div>
      
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
            
            {/* Conversation indicator */}
            {activeConversation && (
              <div className="conversation-indicator">
                <span className="conversation-title-badge">
                  {activeConversation.title}
                </span>
              </div>
            )}
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
                  files={globalFiles}
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