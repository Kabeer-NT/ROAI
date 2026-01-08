import { useRef, useEffect, useCallback, useState } from 'react'
import {
  Sidebar,
  ChatMessage,
  LoadingMessage,
  ChatInput,
  Welcome,
} from '../components'
import { useModels, useSpreadsheets, useChat } from '../hooks'

export function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { models, selectedModel, setSelectedModel, status } = useModels()
  const { files, isUploading, uploadFile, removeFile } = useSpreadsheets()
  const { messages, isLoading, sendMessage, addSystemMessage } = useChat(selectedModel, files)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        addSystemMessage(`📊 Loaded **${uploaded.filename}**\n\n${sheetsSummary}`)
      } else {
        addSystemMessage(`❌ Failed to upload **${file.name}**`)
      }
    }
  }, [uploadFile, addSystemMessage])

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
        onFileRemove={removeFile}
        onFilesAdd={handleFilesAdd}
        isUploading={isUploading}
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
          disabled={isLoading || status === 'error'}
          placeholder={placeholder}
        />
      </main>
    </div>
  )
}
