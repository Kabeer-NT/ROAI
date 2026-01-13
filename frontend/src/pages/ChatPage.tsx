import { useRef, useEffect, useCallback, useState } from 'react'
import {
  Sidebar,
  ChatMessage,
  LoadingMessage,
  ChatInput,
  Welcome,
} from '../components'
import { useModels, useSpreadsheets, useChat, useFileHandle, useTheme } from '../hooks'

export function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { theme, toggleTheme } = useTheme()
  const { models, selectedModel, setSelectedModel, status } = useModels()
  const { files, isUploading, uploadFile, reuploadFile, removeFile } = useSpreadsheets()
  const { messages, isLoading, sendMessage, addSystemMessage } = useChat(selectedModel, files)

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
        addSystemMessage(`🔄 **${file.name}** changed — reloading...`)
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

  const handleFilesAddWithHandle = useCallback(async () => {
    if (!fileSystemSupported) return false

    try {
      const results = await openMultipleFiles()
      
      for (const { file, handle } of results) {
        const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
        if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
          addSystemMessage(`❌ **${file.name}** is not a supported file type. Use .xlsx, .csv, or .tsv`)
          continue
        }

        const uploaded = await uploadFile(file)
        if (uploaded) {
          const handleId = `handle-${Date.now()}-${Math.random().toString(36).slice(2)}`
          storeHandle(handleId, handle, file.name, file.lastModified)
          fileHandleMap.current.set(uploaded.id, handleId)

          const sheetsSummary = uploaded.sheets
            .map(s => `**${s.name}** — ${s.rows} rows, ${s.columns} columns`)
            .join('\n')
          addSystemMessage(`📊 Loaded **${uploaded.filename}** (auto-reload enabled)\n\n${sheetsSummary}`)
        } else {
          addSystemMessage(`❌ Failed to upload **${file.name}**`)
        }
      }
      return true
    } catch (err) {
      console.error('File picker error:', err)
      return false
    }
  }, [fileSystemSupported, openMultipleFiles, uploadFile, storeHandle, addSystemMessage])

  const handleFilesAdd = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const validExtensions = ['.xlsx', '.xls', '.csv', '.tsv']
      if (!validExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
        addSystemMessage(`❌ **${file.name}** is not a supported file type. Use .xlsx, .csv, or .tsv`)
        continue
      }

      const uploaded = await uploadFile(file)
      if (uploaded) {
        const sheetsSummary = uploaded.sheets
          .map(s => `**${s.name}** — ${s.rows} rows, ${s.columns} columns`)
          .join('\n')
        const note = fileSystemSupported ? ' (use file picker for auto-reload)' : ''
        addSystemMessage(`📊 Loaded **${uploaded.filename}**${note}\n\n${sheetsSummary}`)
      } else {
        addSystemMessage(`❌ Failed to upload **${file.name}**`)
      }
    }
  }, [uploadFile, addSystemMessage, fileSystemSupported])

  const handleFileRemove = useCallback((id: string) => {
    const handleId = fileHandleMap.current.get(id)
    if (handleId) {
      removeHandle(handleId)
      fileHandleMap.current.delete(id)
    }
    removeFile(id)
  }, [removeFile, removeHandle])

  const handleHintClick = (hint: string) => {
    sendMessage(hint)
  }

  const placeholder = files.length > 0
    ? `Ask about ${files.map(f => f.filename).join(', ')}...`
    : 'Upload a spreadsheet to get started...'

  return (
    <div className="app">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        status={status}
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
      />

      <main className="main">
        <div className="chat-area">
          {messages.length === 0 ? (
            <Welcome onHintClick={handleHintClick} />
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
          disabled={isLoading || status === 'error'}
          placeholder={placeholder}
        />
      </main>
    </div>
  )
}