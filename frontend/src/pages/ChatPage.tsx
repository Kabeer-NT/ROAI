import { useRef, useEffect, useCallback, useState } from 'react'
import {
  Sidebar,
  ChatMessage,
  LoadingMessage,
  ChatInput,
  Welcome,
  ToastContainer,
} from '../components'
import { useModels, useSpreadsheets, useFileHandle, useTheme, useVisibility } from '../hooks'
import { useChat } from '../hooks'
import { useToast } from '../components/Toast'

export function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)  // NEW: Track when to show suggestions
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { theme, toggleTheme } = useTheme()
  const { models, selectedModel, setSelectedModel } = useModels()
  const { files, isUploading, uploadFile, reuploadFile, removeFile } = useSpreadsheets()
  const { toasts, addToast, dismissToast } = useToast()
  
  // Visibility management - now with sheet-scoped support
  const { 
    getFileVisibility,
    setFileVisibility,
    getSheetVisibility,
    setSheetVisibility,
    clearVisibility,
    getAllSerializedVisibility,
    stats: visibilityStats 
  } = useVisibility()

  // Chat with visibility support
  const { messages, isLoading, sendMessage: originalSendMessage, addSystemMessage } = useChat(
    selectedModel, 
    files,
    { getAllSerializedVisibility }
  )

  // Wrap sendMessage to hide suggestions after first user message
  const sendMessage = useCallback((content: string) => {
    setShowSuggestions(false)  // Hide suggestions when user sends first message
    originalSendMessage(content)
  }, [originalSendMessage])

  // File handle management for auto-reload
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
        .find(([_, hId]) => hId === handleId)?.[0]
      
      if (fileId) {
        addSystemMessage(`📄 **${file.name}** changed — reloading...`)
        const updated = await reuploadFile(fileId, file)
        if (updated) {
          const sheetsSummary = updated.sheets
            .map(s => `**${s.name}** — ${s.rows} rows, ${s.columns} columns`)
            .join('\n')
          addSystemMessage(`📊 Reloaded **${updated.filename}**\n\n${sheetsSummary}`)
        } else {
          addSystemMessage(`❌ Failed to reload **${file.name}**`)
        }
      }
    },
    onError: (err) => {
      console.error('File handle error:', err)
    }
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Helper to show toast and trigger suggestions after successful upload
  const handleUploadSuccess = useCallback((filename: string, sheetCount: number, totalRows: number) => {
    addToast(`${filename} uploaded successfully`, 'success', 3000)
    
    // Show suggestions after a short delay (after toast appears)
    setTimeout(() => {
      setShowSuggestions(true)
    }, 500)
  }, [addToast])

  const handleFilesAddWithHandle = useCallback(async () => {
    if (!fileSystemSupported) return false

    try {
      const results = await openMultipleFiles()
      
      for (const { file, handle } of results) {
        const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
        if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
          addToast(`${file.name} is not a supported file type`, 'error', 4000)
          continue
        }

        const uploaded = await uploadFile(file)
        if (uploaded) {
          const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
          storeHandle(handleId, handle, file.name, file.lastModified)
          fileHandleMap.current.set(uploaded.id, handleId)

          // Show success toast and trigger suggestions
          const totalRows = uploaded.sheets.reduce((sum, s) => sum + s.rows, 0)
          handleUploadSuccess(uploaded.filename, uploaded.sheets.length, totalRows)
        } else {
          addToast(`Failed to upload ${file.name}`, 'error', 4000)
        }
      }
      return true
    } catch (err) {
      console.error('File picker error:', err)
      return false
    }
  }, [fileSystemSupported, openMultipleFiles, uploadFile, storeHandle, handleUploadSuccess, addToast])

  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
      if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
        addToast(`${file.name} is not a supported file type`, 'error', 4000)
        continue
      }

      const uploaded = await uploadFile(file)
      if (uploaded) {
        // Show success toast and trigger suggestions
        const totalRows = uploaded.sheets.reduce((sum, s) => sum + s.rows, 0)
        handleUploadSuccess(uploaded.filename, uploaded.sheets.length, totalRows)
      } else {
        addToast(`Failed to upload ${file.name}`, 'error', 4000)
      }
    }
  }, [uploadFile, handleUploadSuccess, addToast])

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
    
    // Hide suggestions if no files left
    if (files.length <= 1) {
      setShowSuggestions(false)
    }
  }, [files, removeFile, removeHandle, clearVisibility])

  const handleHintClick = (hint: string) => {
    sendMessage(hint)
  }

  const placeholder = files.length > 0
    ? `Ask about ${files.map(f => f.filename).join(', ')}...`
    : 'Upload a spreadsheet to get started...'

  // Determine if we should show welcome (no messages yet)
  const showWelcome = messages.length === 0

  return (
    <div className="app">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        files={files}
        onFileRemove={handleFileRemove}
        onFilesAdd={handleFilesAdd}
        onFilePickerOpen={fileSystemSupported ? handleFilesAddWithHandle : undefined}
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
          {showWelcome ? (
            <Welcome 
              onHintClick={handleHintClick} 
              hasFiles={files.length > 0}
              showSuggestions={showSuggestions}
            />
          ) : (
            <div className="messages">
              {messages.map(msg => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
              {isLoading && <LoadingMessage />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <ChatInput
          onSend={sendMessage}
          onFilesAdd={handleFilesAdd}
          onFilePickerOpen={fileSystemSupported ? handleFilesAddWithHandle : undefined}
          disabled={isLoading}
          placeholder={placeholder}
        />
      </main>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}