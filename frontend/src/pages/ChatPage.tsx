import { useState, useEffect, useCallback, useRef } from 'react'
import { MessageSquare, LayoutGrid } from 'lucide-react'
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
import type { SelectionRange } from '../components/StructureViewer'
import {
  useModels,
  useSpreadsheets,
  useChat,
  useFileHandle,
  useTheme,
  useVisibility,
} from '../hooks'

type ViewMode = 'reference' | 'work'

export function ChatPage() {
  // Theme
  const { theme, toggleTheme } = useTheme()
  
  // View mode (reference = chat only, work = split view)
  const [viewMode, setViewMode] = useState<ViewMode>('reference')
  
  // Active file for work mode (which file to show in the workspace)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  
  // Selection context for chat (when user selects cells and clicks "Ask R-O-AI")
  const [selectionContext, setSelectionContext] = useState<SelectionRange | null>(null)
  
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true)
  
  // Model selection
  const { models, selectedModel, setSelectedModel } = useModels()
  
  // Spreadsheets
  const {
    files,
    isUploading,
    uploadFile,
    reuploadFile,
    removeFile,
  } = useSpreadsheets()
  
  // Visibility controls
  const {
    getFileVisibility,
    setFileVisibility,
    getAllSerializedVisibility,
    clearVisibility,
    stats: visibilityStats,
  } = useVisibility()
  
  // Chat with visibility support
  const { messages, isLoading, sendMessage: sendChatMessage } = useChat(
    selectedModel,
    files,
    { getAllSerializedVisibility }
  )
  
  // File handles for auto-reload
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
  
  // Toast notifications
  const { toasts, addToast, dismissToast } = useToast()
  
  // Track file handle mappings
  const fileHandleMap = useRef<Map<string, string>>(new Map())
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // State for suggestions
  const [showSuggestions, setShowSuggestions] = useState(false)
  
  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  // Show suggestions when files are uploaded
  useEffect(() => {
    if (files.length > 0 && !showSuggestions) {
      const timer = setTimeout(() => setShowSuggestions(true), 500)
      return () => clearTimeout(timer)
    }
    if (files.length === 0) {
      setShowSuggestions(false)
    }
  }, [files.length, showSuggestions])
  
  // File picker with File System Access API
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
        
        const uploaded = await uploadFile(file)
        if (uploaded) {
          const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
          storeHandle(handleId, handle, file.name, file.lastModified)
          fileHandleMap.current.set(uploaded.id, handleId)
          addToast(`✅ Loaded ${uploaded.filename}`, 'success')
        } else {
          addToast(`❌ Failed to upload ${file.name}`, 'error')
        }
      }
      return true
    } catch (err) {
      console.error('File picker error:', err)
      return false
    }
  }, [fileSystemSupported, openMultipleFiles, uploadFile, storeHandle, addToast])
  
  // Fallback file handler
  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
      if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
        addToast(`❌ ${file.name} is not supported`, 'error')
        continue
      }
      
      const uploaded = await uploadFile(file)
      if (uploaded) {
        addToast(`✅ Loaded ${uploaded.filename}`, 'success')
      } else {
        addToast(`❌ Failed to upload ${file.name}`, 'error')
      }
    }
  }, [uploadFile, addToast])
  
  // File removal
  const handleFileRemove = useCallback((id: string) => {
    const file = files.find(f => f.id === id)
    const handleId = fileHandleMap.current.get(id)
    if (handleId) {
      removeHandle(handleId)
      fileHandleMap.current.delete(id)
    }
    if (file) {
      clearVisibility(file.filename)
    }
    removeFile(id)
  }, [files, removeFile, removeHandle, clearVisibility])
  
  // Click handlers
  const handleHintClick = useCallback((hint: string) => {
    sendChatMessage(hint)
    setShowSuggestions(false)
  }, [sendChatMessage])
  
  const handleFollowupClick = useCallback((text: string) => {
    sendChatMessage(text)
  }, [sendChatMessage])
  
  // Handle "Ask R-O-AI" from cell selection - just set the context, don't auto-send
  const handleAskAI = useCallback((selection: SelectionRange) => {
    setSelectionContext(selection)
    // Don't auto-send - let user type their question
  }, [])
  
  // Clear selection context
  const handleClearSelection = useCallback(() => {
    setSelectionContext(null)
  }, [])
  
  // Send message with optional selection context
  const handleSendMessage = useCallback((message: string, context?: SelectionRange) => {
    // If we have selection context, prepend it to the message for Claude
    if (context) {
      const contextPrefix = `[Context: Looking at cells ${context.rangeString} on sheet "${context.sheetName}"]\n\n`
      sendChatMessage(contextPrefix + message)
    } else {
      sendChatMessage(message)
    }
    // Clear selection after sending
    setSelectionContext(null)
  }, [sendChatMessage])
  
  // Derived state
  const hasMessages = messages.length > 0
  const hasFiles = files.length > 0
  
  // Auto-select first file for work mode when files change
  useEffect(() => {
    if (files.length > 0 && !activeFileId) {
      setActiveFileId(files[0].id)
    } else if (files.length === 0) {
      setActiveFileId(null)
    } else if (activeFileId && !files.find(f => f.id === activeFileId)) {
      // Active file was removed, select another
      setActiveFileId(files[0]?.id || null)
    }
  }, [files, activeFileId])
  
  // Get the active file object
  const activeFile = files.find(f => f.id === activeFileId) || null

  return (
    <div className="app" data-theme={theme}>
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
      />
      
      <main className={`main ${viewMode === 'work' ? 'work-mode' : 'reference-mode'}`}>
        {/* Mode Toggle - only show when files are loaded */}
        {hasFiles && (
          <div className="mode-toggle-bar">
            <div className="mode-toggle">
              <button
                className={`mode-btn ${viewMode === 'reference' ? 'active' : ''}`}
                onClick={() => setViewMode('reference')}
              >
                <MessageSquare size={16} />
                <span>Reference</span>
              </button>
              <button
                className={`mode-btn ${viewMode === 'work' ? 'active' : ''}`}
                onClick={() => setViewMode('work')}
              >
                <LayoutGrid size={16} />
                <span>Work</span>
              </button>
            </div>
          </div>
        )}
        
        {/* Main Content Area */}
        <div className="content-area">
          {/* Workspace Panel - only in work mode with files */}
          {viewMode === 'work' && activeFile && (
            <div className="workspace-panel">
              <WorkspacePanel
                file={activeFile}
                files={files}
                onFileSelect={setActiveFileId}
                fileVisibility={getFileVisibility(activeFile.filename)}
                onFileVisibilityChange={(vis) => setFileVisibility(activeFile.filename, vis)}
                onAskAI={handleAskAI}
              />
            </div>
          )}
          
          {/* Chat Panel */}
          <div className={`chat-panel ${viewMode === 'work' ? 'narrow' : 'full'}`}>
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
        </div>
      </main>
      
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}