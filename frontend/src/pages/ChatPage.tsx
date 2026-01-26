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
  Settings,
  getDefaultSettings,
  StructureViewer,
} from '../components'
import type { SettingsData } from '../components'
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
  const { token } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const [viewMode, setViewMode] = useState<ViewMode>('reference')
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [selectionContext, setSelectionContext] = useState<SelectionRange | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [showSettings, setShowSettings] = useState(false)
  const [structureViewerFileId, setStructureViewerFileId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData>(() => {
    const saved = localStorage.getItem('roai-settings')
    if (saved) {
      try { return { ...getDefaultSettings(), ...JSON.parse(saved) } } 
      catch { return getDefaultSettings() }
    }
    return getDefaultSettings()
  })

  useEffect(() => {
    localStorage.setItem('roai-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (settings.theme !== theme) toggleTheme()
  }, [settings.theme, theme, toggleTheme])

  const handleSettingsChange = useCallback((newSettings: SettingsData) => {
    setSettings(newSettings)
    if (newSettings.theme !== theme) toggleTheme()
  }, [theme, toggleTheme])

  const [workspaceWidth, setWorkspaceWidth] = useState(60)
  const isDragging = useRef(false)
  const contentAreaRef = useRef<HTMLDivElement>(null)

  const { models, selectedModel, setSelectedModel } = useModels()

  useEffect(() => {
    if (settings.model && models.includes(settings.model)) setSelectedModel(settings.model)
  }, [settings.model, models, setSelectedModel])

  const {
    conversations,
    activeConversation,
    isLoading: conversationLoading,
    loadConversation,
    createConversation,
    deleteConversation,
    updateConversation,
    setActiveConversation,
    fetchConversations,
  } = useConversations()

  const {
    getFileVisibility,
    setFileVisibility,
    getAllSerializedVisibility,
    clearVisibility,
    stats: visibilityStats,
  } = useVisibility()

  const fileHandleMap = useRef<Map<string, string>>(new Map())
  const {
    isSupported: fileSystemSupported,
    isReloading,
    storeHandle,
    removeHandle,
    openMultipleFiles,
  } = useFileHandle({
    onFileReloaded: async (handleId, file) => {
      const fileId = Array.from(fileHandleMap.current.entries())
        .find(([, hid]) => hid === handleId)?.[0]
      if (fileId && activeConversation) await handleReuploadFile(fileId, file)
    },
  })

  const { toasts, addToast, dismissToast } = useToast()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(null)

  useEffect(() => { fetchConversations() }, [fetchConversations])

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

  const messages: Message[] = useMemo(() => {
    if (pendingUserMessage) {
      return [...conversationMessages, pendingUserMessage]
    }
    return conversationMessages
  }, [conversationMessages, pendingUserMessage])

  const files: SpreadsheetFile[] = useMemo(() => {
    if (!activeConversation?.files) return []
    return activeConversation.files.map(f => ({
      id: f.file_id,
      filename: f.filename,
      sheets: (f as any).sheets || [],
      uploadedAt: new Date(f.added_at),
    }))
  }, [activeConversation])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (files.length > 0 && !showSuggestions && messages.length === 0) {
      const timer = setTimeout(() => setShowSuggestions(true), 500)
      return () => clearTimeout(timer)
    }
    if (files.length === 0) setShowSuggestions(false)
  }, [files.length, showSuggestions, messages.length])

  useEffect(() => {
    if (selectionContext && chatCollapsed) setChatCollapsed(false)
  }, [selectionContext, chatCollapsed])

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleNewConversation()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleConversationSelect = useCallback(async (id: number) => {
    await loadConversation(id)
  }, [loadConversation])

  const handleNewConversation = useCallback(() => {
    setActiveConversation(null)
  }, [setActiveConversation])

  const handleDeleteConversation = useCallback(async (id: number) => {
    await deleteConversation(id)
    if (activeConversation?.id === id) setActiveConversation(null)
  }, [deleteConversation, activeConversation, setActiveConversation])

  const handleRenameConversation = useCallback(async (id: number, title: string) => {
    await updateConversation(id, { title })
  }, [updateConversation])

  const sendMessage = useCallback(async (content: string, selContext?: SelectionRange) => {
    if (!content.trim() || isLoading || !token) return

    // Show optimistic message IMMEDIATELY - before any async work
    const optimisticUserMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }
    setPendingUserMessage(optimisticUserMessage)
    setIsLoading(true)

    let convId = activeConversation?.id
    let isNewConversation = false
    
    if (!convId) {
      const conv = await createConversation(content.slice(0, 50) + (content.length > 50 ? '...' : ''))
      if (!conv) { 
        addToast('Failed to create conversation', 'error')
        setPendingUserMessage(null)
        setIsLoading(false)
        return 
      }
      convId = conv.id
      isNewConversation = true
      // Don't loadConversation here - it causes message flipping
      // We'll load it after the chat API call completes
    }

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
        conversation_id: convId,
        include_followups: true,
        ...(hasVisibility && { visibility }),
        ...(selection_context && { selection_context }),
      }

      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(requestBody),
      })

      // Now load the conversation with all messages
      await loadConversation(convId)
      await fetchConversations()
    } catch (error) {
      console.error('Chat error:', error)
      addToast('Failed to send message', 'error')
    } finally {
      // Always clear pending message in finally
      setPendingUserMessage(null)
      setIsLoading(false)
      setSelectionContext(null)
    }
  }, [token, conversationMessages, selectedModel, activeConversation, getAllSerializedVisibility, loadConversation, fetchConversations, createConversation, addToast, isLoading])

  const handleUploadFile = useCallback(async (file: File, handle?: FileSystemFileHandle) => {
    if (!token) return null

    let convId = activeConversation?.id
    if (!convId) {
      const conv = await createConversation(file.name.replace(/\.[^/.]+$/, ''))
      if (!conv) { addToast('Failed to create conversation', 'error'); return null }
      convId = conv.id
      await loadConversation(convId)
    }

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/upload?conversation_id=${convId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()

      if (handle) {
        const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
        storeHandle(handleId, handle, file.name, file.lastModified)
        fileHandleMap.current.set(data.file_id, handleId)
      }

      await loadConversation(convId)
      await fetchConversations()
      addToast(`Loaded ${data.filename}`, 'success')
      return data
    } catch (err) {
      addToast(`Failed to upload ${file.name}`, 'error')
      return null
    } finally {
      setIsUploading(false)
    }
  }, [token, activeConversation, storeHandle, loadConversation, fetchConversations, createConversation, addToast])

  const handleReuploadFile = useCallback(async (fileId: string, file: File) => {
    if (!token || !activeConversation) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      await fetch(`/api/spreadsheet/${fileId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
      const res = await fetch(`/api/upload?conversation_id=${activeConversation.id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (res.ok) {
        await loadConversation(activeConversation.id)
        addToast(`Reloaded ${file.name}`, 'info')
      }
    } catch (err) {
      console.error('Reupload error:', err)
    }
  }, [token, activeConversation, loadConversation, addToast])

  const handleFilePickerOpen = useCallback(async () => {
    if (!fileSystemSupported) return false
    try {
      const results = await openMultipleFiles()
      if (results.length === 0) return true
      for (const { file, handle } of results) {
        const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
        if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
          addToast(`${file.name} is not supported`, 'error')
          continue
        }
        await handleUploadFile(file, handle)
      }
      return true
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error('File picker error:', err)
      return false
    }
  }, [fileSystemSupported, openMultipleFiles, handleUploadFile, addToast])

  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
      if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
        addToast(`${file.name} is not supported`, 'error')
        continue
      }
      await handleUploadFile(file)
    }
  }, [handleUploadFile, addToast])

  const handleFileRemove = useCallback(async (fileId: string) => {
    if (!token || !activeConversation) return
    const file = files.find(f => f.id === fileId)
    try {
      await fetch(`/api/conversations/${activeConversation.id}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const handleId = fileHandleMap.current.get(fileId)
      if (handleId) { removeHandle(handleId); fileHandleMap.current.delete(fileId) }
      if (file) clearVisibility(file.filename)
      await loadConversation(activeConversation.id)
      addToast('File removed', 'info')
    } catch (err) {
      addToast('Failed to remove file', 'error')
    }
  }, [token, activeConversation, files, removeHandle, clearVisibility, loadConversation, addToast])

  const handleHintClick = useCallback((hint: string) => {
    sendMessage(hint)
    setShowSuggestions(false)
  }, [sendMessage])

  const handleFollowupClick = useCallback((text: string) => { sendMessage(text) }, [sendMessage])
  const handleAskAI = useCallback((selection: SelectionRange) => { setSelectionContext(selection) }, [])
  const handleClearSelection = useCallback(() => { setSelectionContext(null) }, [])
  const handleSendMessage = useCallback((message: string, context?: SelectionRange) => { sendMessage(message, context) }, [sendMessage])

  const hasMessages = messages.length > 0
  const hasFiles = files.length > 0

  useEffect(() => {
    if (files.length > 0 && !activeFileId) setActiveFileId(files[0].id)
    else if (files.length === 0) setActiveFileId(null)
    else if (activeFileId && !files.find(f => f.id === activeFileId)) setActiveFileId(files[0]?.id || null)
  }, [files, activeFileId])

  const activeFile = files.find(f => f.id === activeFileId) || null
  const showCollapsedChat = viewMode === 'work' && chatCollapsed

  return (
    <div className="app" data-theme={theme}>
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        theme={theme}
        onThemeToggle={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
        onSettingsClick={() => setShowSettings(true)}
        conversations={conversations}
        activeConversationId={activeConversation?.id ?? null}
        onConversationSelect={handleConversationSelect}
        onConversationNew={handleNewConversation}
        onConversationDelete={handleDeleteConversation}
        onConversationRename={handleRenameConversation}
        isLoadingConversations={conversationLoading}
        files={files}
        onFileRemove={handleFileRemove}
        onFilesAdd={handleFilesAdd}
        onFilePickerOpen={fileSystemSupported ? handleFilePickerOpen : undefined}
        onViewStructure={(fileId) => setStructureViewerFileId(fileId)}
        isUploading={isUploading}
        isReloading={isReloading}
        getFileVisibility={getFileVisibility}
        setFileVisibility={setFileVisibility}
        visibilityStats={visibilityStats}
      />

      <main className={`main ${viewMode === 'work' ? 'work-mode' : 'reference-mode'}`}>
        {hasFiles && (
          <div className="mode-toggle-bar">
            <div className="mode-toggle">
              <button className={`mode-btn ${viewMode === 'reference' ? 'active' : ''}`} onClick={() => setViewMode('reference')}>
                <MessageSquare size={16} /><span>Chat</span>
              </button>
              <button className={`mode-btn ${viewMode === 'work' ? 'active' : ''}`} onClick={() => setViewMode('work')}>
                <LayoutGrid size={16} /><span>Cowork</span>
              </button>
            </div>
          </div>
        )}

        <div className="content-area" ref={contentAreaRef}>
          {viewMode === 'work' && activeFile && (
            <>
              <div
                className={`workspace-panel ${showCollapsedChat ? 'expanded' : ''}`}
                style={{ flex: showCollapsedChat ? 1 : `0 0 ${workspaceWidth}%`, maxWidth: showCollapsedChat ? 'none' : `${workspaceWidth}%` }}
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
              <button className="chat-expand-btn" onClick={() => setChatCollapsed(false)}><ChevronLeft size={18} /></button>
              <div className="chat-collapsed-icon"><Hexagon size={24} /></div>
              <span className="chat-collapsed-label">R-O-AI</span>
              {messages.length > 0 && <span className="chat-collapsed-badge">{messages.length}</span>}
            </div>
          ) : (
            <div
              className={`chat-panel ${viewMode === 'work' ? 'narrow' : 'full'}`}
              style={viewMode === 'work' ? { flex: `0 0 ${100 - workspaceWidth}%`, maxWidth: `${100 - workspaceWidth}%`, minWidth: '280px' } : undefined}
            >
              {viewMode === 'work' && (
                <button className="chat-collapse-btn" onClick={() => setChatCollapsed(true)}><ChevronRight size={18} /></button>
              )}
              <div className="chat-area">
                {!hasMessages ? (
                  <Welcome onHintClick={handleHintClick} hasFiles={hasFiles} showSuggestions={showSuggestions} />
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

      <Settings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        models={models}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {structureViewerFileId && (() => {
        const file = files.find(f => f.id === structureViewerFileId)
        if (!file) return null
        return (
          <StructureViewer
            fileId={file.id}
            filename={file.filename}
            isOpen={true}
            onClose={() => setStructureViewerFileId(null)}
            fileVisibility={getFileVisibility(file.filename)}
            onFileVisibilityChange={(vis) => setFileVisibility(file.filename, vis)}
          />
        )
      })()}
    </div>
  )
}