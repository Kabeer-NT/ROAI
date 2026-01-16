import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Send, Plus, X, Table } from 'lucide-react'
import type { SelectionRange } from './StructureViewer'

// ============================================================================
// ChatInput - Text input with file upload and selection context support
// ============================================================================

interface ChatInputProps {
  onSend: (message: string, selectionContext?: SelectionRange) => void
  onFilesAdd?: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  disabled?: boolean
  hasFiles?: boolean
  // Selection context from "Ask R-O-AI" action
  selectionContext?: SelectionRange | null
  onClearSelection?: () => void
}

export function ChatInput({
  onSend,
  onFilesAdd,
  onFilePickerOpen,
  disabled = false,
  hasFiles = false,
  selectionContext,
  onClearSelection,
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Focus textarea when selection context is set
  useEffect(() => {
    if (selectionContext && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [selectionContext])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || disabled) return
    
    onSend(trimmed, selectionContext || undefined)
    setInput('')
    onClearSelection?.()
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileClick = async () => {
    // Try File System Access API first
    if (onFilePickerOpen) {
      const handled = await onFilePickerOpen()
      if (handled) return
    }
    // Fallback to input element
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onFilesAdd) {
      onFilesAdd(e.target.files)
      e.target.value = '' // Reset for next upload
    }
  }

  const placeholder = selectionContext
    ? `Ask about ${selectionContext.rangeString}...`
    : hasFiles
    ? 'Ask about your spreadsheet...'
    : 'Upload a spreadsheet to get started...'

  return (
    <div className="chat-input-wrapper">
      {/* Selection Context Chip */}
      {selectionContext && (
        <div className="selection-context-chip">
          <Table size={14} className="chip-icon" />
          <span className="chip-sheet">{selectionContext.sheetName}</span>
          <span className="chip-range">{selectionContext.rangeString}</span>
          <button 
            className="chip-dismiss"
            onClick={onClearSelection}
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      )}
      
      {/* Input Area */}
      <div className={`chat-input ${selectionContext ? 'has-context' : ''}`}>
        <button
          className="input-action-btn"
          onClick={handleFileClick}
          disabled={disabled}
          aria-label="Add file"
        >
          <Plus size={20} />
        </button>
        
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="input-textarea"
        />
        
        <button
          className="input-send-btn"
          onClick={handleSubmit}
          disabled={disabled || !input.trim()}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
        
        {/* Hidden file input for fallback */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}