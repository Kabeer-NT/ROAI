import { useState, useRef, useEffect } from 'react'
import { Paperclip, Send } from 'lucide-react'

interface ChatInputProps {
  onSend: (message: string) => void
  onFilesAdd: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  disabled: boolean
  placeholder?: string
  hasFiles?: boolean
}

export function ChatInput({ 
  onSend, 
  onFilesAdd, 
  onFilePickerOpen, 
  disabled, 
  placeholder,
  hasFiles = false 
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Better default placeholder based on state
  const defaultPlaceholder = hasFiles 
    ? 'Ask a question about your data...'
    : 'Type a message...'

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input)
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleAttachClick = async () => {
    if (onFilePickerOpen) {
      const handled = await onFilePickerOpen()
      if (handled) return
    }
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdd(e.target.files)
      e.target.value = ''
    }
  }

  return (
    <div className="input-wrapper">
      <div className="input-box">
        <button
          className="attach-btn"
          onClick={handleAttachClick}
          title="Upload spreadsheet"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            multiple
            onChange={handleFileChange}
            hidden
          />
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || defaultPlaceholder}
          rows={1}
          disabled={disabled}
        />
        <button
          className="send-btn"
          onClick={handleSubmit}
          disabled={disabled || !input.trim()}
        >
          <Send size={18} />
        </button>
      </div>
      <div className="input-hint">Press Enter to send · Shift+Enter for new line</div>
    </div>
  )
}