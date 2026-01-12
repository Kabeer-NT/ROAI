import { useState, useEffect, useCallback, useRef } from 'react'

export interface FileHandleEntry {
  id: string
  handle: FileSystemFileHandle
  filename: string
  lastModified: number
}

interface UseFileHandleOptions {
  onFileReloaded?: (id: string, file: File) => void
  onError?: (error: Error) => void
}

/**
 * Hook to manage file handles using the File System Access API.
 * Maintains handles to files so they can be re-read when the tab regains focus,
 * enabling auto-reload of spreadsheets as they autosave.
 */
export function useFileHandle(options: UseFileHandleOptions = {}) {
  const [handles, setHandles] = useState<Map<string, FileHandleEntry>>(new Map())
  const [isSupported] = useState(() => 'showOpenFilePicker' in window)
  const [isReloading, setIsReloading] = useState(false)
  const lastCheckRef = useRef<number>(Date.now())

  // Store a file handle after upload
  const storeHandle = useCallback((id: string, handle: FileSystemFileHandle, filename: string, lastModified: number) => {
    setHandles(prev => {
      const next = new Map(prev)
      next.set(id, { id, handle, filename, lastModified })
      return next
    })
  }, [])

  // Remove a file handle
  const removeHandle = useCallback((id: string) => {
    setHandles(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Clear all handles
  const clearHandles = useCallback(() => {
    setHandles(new Map())
  }, [])

  // Check a single file for updates
  const checkFile = useCallback(async (entry: FileHandleEntry): Promise<File | null> => {
    try {
      // Request permission if needed (browser may have revoked it)
      const permission = await entry.handle.queryPermission({ mode: 'read' })
      if (permission !== 'granted') {
        const requested = await entry.handle.requestPermission({ mode: 'read' })
        if (requested !== 'granted') {
          console.warn(`Permission denied for ${entry.filename}`)
          return null
        }
      }

      const file = await entry.handle.getFile()
      
      // Check if file was modified since last check
      if (file.lastModified > entry.lastModified) {
        return file
      }
      
      return null
    } catch (err) {
      console.error(`Error checking file ${entry.filename}:`, err)
      return null
    }
  }, [])

  // Check all files for updates
  const checkAllFiles = useCallback(async () => {
    if (handles.size === 0 || isReloading) return

    setIsReloading(true)
    const now = Date.now()
    
    // Debounce: don't check more than once per second
    if (now - lastCheckRef.current < 1000) {
      setIsReloading(false)
      return
    }
    lastCheckRef.current = now

    try {
      for (const [id, entry] of handles) {
        const updatedFile = await checkFile(entry)
        if (updatedFile) {
          // Update the stored lastModified time
          setHandles(prev => {
            const next = new Map(prev)
            const existing = next.get(id)
            if (existing) {
              next.set(id, { ...existing, lastModified: updatedFile.lastModified })
            }
            return next
          })
          
          // Notify caller
          options.onFileReloaded?.(id, updatedFile)
        }
      }
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error('Failed to check files'))
    } finally {
      setIsReloading(false)
    }
  }, [handles, isReloading, checkFile, options])

  // Open file picker using File System Access API
  const openFilePicker = useCallback(async (): Promise<{ file: File; handle: FileSystemFileHandle } | null> => {
    if (!isSupported) {
      console.warn('File System Access API not supported')
      return null
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Spreadsheet files',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls'],
              'text/csv': ['.csv'],
              'text/tab-separated-values': ['.tsv'],
            },
          },
        ],
        multiple: false,
      })

      const file = await handle.getFile()
      return { file, handle }
    } catch (err) {
      // User cancelled the picker
      if (err instanceof Error && err.name === 'AbortError') {
        return null
      }
      throw err
    }
  }, [isSupported])

  // Open multiple files
  const openMultipleFiles = useCallback(async (): Promise<Array<{ file: File; handle: FileSystemFileHandle }>> => {
    if (!isSupported) {
      console.warn('File System Access API not supported')
      return []
    }

    try {
      const handles = await window.showOpenFilePicker({
        types: [
          {
            description: 'Spreadsheet files',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls'],
              'text/csv': ['.csv'],
              'text/tab-separated-values': ['.tsv'],
            },
          },
        ],
        multiple: true,
      })

      const results = await Promise.all(
        handles.map(async (handle) => {
          const file = await handle.getFile()
          return { file, handle }
        })
      )

      return results
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return []
      }
      throw err
    }
  }, [isSupported])

  // Listen for visibility change (tab focus)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let the file system catch up
        setTimeout(checkAllFiles, 200)
      }
    }

    const handleFocus = () => {
      setTimeout(checkAllFiles, 200)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
    }
  }, [checkAllFiles])

  return {
    handles,
    isSupported,
    isReloading,
    storeHandle,
    removeHandle,
    clearHandles,
    openFilePicker,
    openMultipleFiles,
    checkAllFiles,
  }
}