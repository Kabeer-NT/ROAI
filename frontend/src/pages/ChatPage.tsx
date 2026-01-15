import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sidebar,
  ChatMessage,
  LoadingMessage,
  ChatInput,
  Welcome,
  ToastContainer,
  useToast,
} from '../components'
import {
  useModels,
  useSpreadsheets,
  useChat,
  useFileHandle,
  useTheme,
  useVisibility,
} from '../hooks'

export function ChatPage() {
  // Theme
  const { theme, toggleTheme } = useTheme()
  
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
  const { messages, isLoading, sendMessage } = useChat(
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
    sendMessage(hint)
    setShowSuggestions(false)
  }, [sendMessage])
  
  const handleFollowupClick = useCallback((text: string) => {
    sendMessage(text)
  }, [sendMessage])
  
  // Derived state
  const hasMessages = messages.length > 0
  const hasFiles = files.length > 0

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
      
      <main className="main">
        <div className="chat-area">
          {!hasMessages ? (
            <Welcome
              onHintClick={handleHintClick}
              hasFiles={hasFiles}
              showSuggestions={showSuggestions}
            />
          ) : (
            <>
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
            </>
          )}
        </div>
        
        <div className="input-container">
          <ChatInput
            onSend={sendMessage}
            onFilesAdd={handleFilesAdd}
            onFilePickerOpen={fileSystemSupported ? handleFilePickerOpen : undefined}
            disabled={isLoading}
            hasFiles={hasFiles}
          />
        </div>
      </main>
      
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}