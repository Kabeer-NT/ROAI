import { useState, useCallback, useRef } from 'react'

interface DropZoneProps {
  onFilesAdd: (files: FileList) => void
  onFilePickerOpen?: () => Promise<boolean>
  isUploading: boolean
}

export function DropZone({ onFilesAdd, onFilePickerOpen, isUploading }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      onFilesAdd(files)
    }
  }, [onFilesAdd])

  const handleClick = async () => {
    // Prefer File System Access API if available (enables auto-reload)
    if (onFilePickerOpen) {
      const handled = await onFilePickerOpen()
      if (handled) return
    }
    // Fallback to regular file input
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesAdd(e.target.files)
      e.target.value = ''
    }
  }

  return (
    <div
      className={`drop-zone ${isDragging ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv"
        multiple
        onChange={handleChange}
        hidden
      />
      <div className="drop-zone-content">
        {isUploading ? (
          <>
            <span className="drop-zone-spinner" />
            <span>Uploading...</span>
          </>
        ) : isDragging ? (
          <>
            <span className="drop-zone-icon">↓</span>
            <span>Drop files here</span>
          </>
        ) : (
          <>
            <span className="drop-zone-icon">+</span>
            <span>Drop files or click to upload</span>
            <span className="drop-zone-hint">.xlsx, .csv, .tsv</span>
          </>
        )}
      </div>
    </div>
  )
}