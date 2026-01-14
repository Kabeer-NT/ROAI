import { useState, useCallback, useMemo } from 'react'

// ============================================================================
// Types - Now SHEET-SCOPED
// ============================================================================

/**
 * Visibility state for a single sheet within a file.
 * Cell addresses are local to the sheet (e.g., "A1", "B2").
 */
export interface SheetVisibilityState {
  hiddenColumns: Set<string>  // Column letters: "A", "B", "C"
  hiddenRows: Set<number>     // Row numbers: 1, 2, 3
  hiddenCells: Set<string>    // Individual cells: "A1", "B2"
}

/**
 * Visibility state for an entire file, organized by sheet name.
 */
export interface FileVisibilityState {
  [sheetName: string]: SheetVisibilityState
}

/**
 * Serialized format for a single sheet (for API/storage).
 */
export interface SerializedSheetVisibility {
  hiddenColumns: string[]
  hiddenRows: number[]
  hiddenCells: string[]
}

/**
 * Serialized format for an entire file (for API/storage).
 */
export interface SerializedFileVisibility {
  [sheetName: string]: SerializedSheetVisibility
}

/**
 * Legacy format (flat, not sheet-scoped) - for backward compatibility
 */
export interface LegacySerializedVisibility {
  hiddenColumns: string[]
  hiddenRows: number[]
  hiddenCells: string[]
}

// For backward compatibility with existing components
export type VisibilityState = SheetVisibilityState
export type SerializedVisibility = SerializedSheetVisibility

// Per-file visibility, keyed by FILENAME
type FileVisibilityMap = Map<string, FileVisibilityState>

// ============================================================================
// Helpers
// ============================================================================

function createEmptySheetVisibility(): SheetVisibilityState {
  return {
    hiddenColumns: new Set(),
    hiddenRows: new Set(),
    hiddenCells: new Set(),
  }
}

function createEmptyFileVisibility(): FileVisibilityState {
  return {}
}

export function serializeSheetVisibility(visibility: SheetVisibilityState): SerializedSheetVisibility {
  return {
    hiddenColumns: [...visibility.hiddenColumns],
    hiddenRows: [...visibility.hiddenRows],
    hiddenCells: [...visibility.hiddenCells],
  }
}

export function deserializeSheetVisibility(data: SerializedSheetVisibility): SheetVisibilityState {
  return {
    hiddenColumns: new Set(data.hiddenColumns),
    hiddenRows: new Set(data.hiddenRows),
    hiddenCells: new Set(data.hiddenCells),
  }
}

export function serializeFileVisibility(fileVisibility: FileVisibilityState): SerializedFileVisibility {
  const result: SerializedFileVisibility = {}
  for (const [sheetName, sheetVis] of Object.entries(fileVisibility)) {
    const serialized = serializeSheetVisibility(sheetVis)
    // Only include if there's something hidden
    if (serialized.hiddenColumns.length > 0 || 
        serialized.hiddenRows.length > 0 || 
        serialized.hiddenCells.length > 0) {
      result[sheetName] = serialized
    }
  }
  return result
}

export function deserializeFileVisibility(data: SerializedFileVisibility): FileVisibilityState {
  const result: FileVisibilityState = {}
  for (const [sheetName, sheetData] of Object.entries(data)) {
    result[sheetName] = deserializeSheetVisibility(sheetData)
  }
  return result
}

/**
 * Check if a cell address is hidden based on sheet visibility state
 */
export function isCellHidden(
  cellAddr: string,
  visibility: SheetVisibilityState
): boolean {
  // Direct cell hide
  if (visibility.hiddenCells.has(cellAddr)) return true
  
  // Extract column and row from cell address
  const match = cellAddr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return false
  
  const [, col, rowStr] = match
  const row = parseInt(rowStr, 10)
  
  // Column hidden
  if (visibility.hiddenColumns.has(col)) return true
  
  // Row hidden
  if (visibility.hiddenRows.has(row)) return true
  
  return false
}

/**
 * Count total hidden items across all sheets in a file
 */
function countFileHidden(fileVisibility: FileVisibilityState): number {
  let total = 0
  for (const sheetVis of Object.values(fileVisibility)) {
    total += sheetVis.hiddenColumns.size
    total += sheetVis.hiddenRows.size
    total += sheetVis.hiddenCells.size
  }
  return total
}

// ============================================================================
// Hook
// ============================================================================

const STORAGE_KEY = 'roai_visibility_v3'  // New version for sheet-scoped data

export function useVisibility() {
  // Load initial state from localStorage
  const [visibilityMap, setVisibilityMap] = useState<FileVisibilityMap>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, SerializedFileVisibility>
        const map = new Map<string, FileVisibilityState>()
        Object.entries(parsed).forEach(([filename, fileData]) => {
          map.set(filename, deserializeFileVisibility(fileData))
        })
        return map
      }
      
      // Try to migrate from v2 format (flat, not sheet-scoped)
      const oldSaved = localStorage.getItem('roai_visibility_v2')
      if (oldSaved) {
        console.log('Migrating visibility from v2 to v3 format...')
        // Old format doesn't have sheet info, so we can't migrate meaningfully
        // Just start fresh
        localStorage.removeItem('roai_visibility_v2')
      }
    } catch (e) {
      console.error('Failed to load visibility state:', e)
    }
    return new Map()
  })

  // Save to localStorage whenever state changes
  const saveToStorage = useCallback((map: FileVisibilityMap) => {
    try {
      const serialized: Record<string, SerializedFileVisibility> = {}
      map.forEach((fileVisibility, filename) => {
        const fileSerialized = serializeFileVisibility(fileVisibility)
        if (Object.keys(fileSerialized).length > 0) {
          serialized[filename] = fileSerialized
        }
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized))
    } catch (e) {
      console.error('Failed to save visibility state:', e)
    }
  }, [])

  // Get visibility for a specific sheet within a file
  const getSheetVisibility = useCallback((filename: string, sheetName: string): SheetVisibilityState => {
    const fileVis = visibilityMap.get(filename)
    if (!fileVis || !fileVis[sheetName]) {
      return createEmptySheetVisibility()
    }
    return fileVis[sheetName]
  }, [visibilityMap])

  // Set visibility for a specific sheet within a file
  const setSheetVisibility = useCallback((filename: string, sheetName: string, visibility: SheetVisibilityState) => {
    setVisibilityMap(prev => {
      const next = new Map(prev)
      const fileVis = next.get(filename) ?? createEmptyFileVisibility()
      fileVis[sheetName] = visibility
      next.set(filename, fileVis)
      saveToStorage(next)
      return next
    })
  }, [saveToStorage])

  // Get visibility for entire file (all sheets) - for backward compatibility
  // Returns the visibility for the first sheet or empty if no sheets
  const getVisibility = useCallback((filename: string): SheetVisibilityState => {
    const fileVis = visibilityMap.get(filename)
    if (!fileVis) {
      return createEmptySheetVisibility()
    }
    // Return first sheet's visibility for backward compatibility
    const sheetNames = Object.keys(fileVis)
    if (sheetNames.length === 0) {
      return createEmptySheetVisibility()
    }
    return fileVis[sheetNames[0]]
  }, [visibilityMap])

  // Set visibility for a file - for backward compatibility
  // This sets visibility for a default sheet name
  const setVisibility = useCallback((filename: string, visibility: SheetVisibilityState, sheetName: string = '_default') => {
    setSheetVisibility(filename, sheetName, visibility)
  }, [setSheetVisibility])

  // Get full file visibility (all sheets)
  const getFileVisibility = useCallback((filename: string): FileVisibilityState => {
    return visibilityMap.get(filename) ?? createEmptyFileVisibility()
  }, [visibilityMap])

  // Set visibility for entire file (all sheets at once)
  const setFileVisibility = useCallback((filename: string, fileVis: FileVisibilityState) => {
    setVisibilityMap(prev => {
      const next = new Map(prev)
      next.set(filename, fileVis)
      saveToStorage(next)
      return next
    })
  }, [saveToStorage])

  // Clear visibility for a specific file
  const clearVisibility = useCallback((filename: string) => {
    setVisibilityMap(prev => {
      const next = new Map(prev)
      next.delete(filename)
      saveToStorage(next)
      return next
    })
  }, [saveToStorage])

  // Clear all visibility
  const clearAllVisibility = useCallback(() => {
    setVisibilityMap(new Map())
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  // Get serialized visibility for a single sheet (for API calls)
  const getSerializedSheetVisibility = useCallback((filename: string, sheetName: string): SerializedSheetVisibility | null => {
    const sheetVis = getSheetVisibility(filename, sheetName)
    const serialized = serializeSheetVisibility(sheetVis)
    if (
      serialized.hiddenColumns.length === 0 &&
      serialized.hiddenRows.length === 0 &&
      serialized.hiddenCells.length === 0
    ) {
      return null
    }
    return serialized
  }, [getSheetVisibility])

  // Get all visibility for all files (for API calls) - NEW FORMAT with sheets
  // Returns: { "filename.xlsx": { "Sheet1": {...}, "Sheet2": {...} } }
  const getAllSerializedVisibility = useCallback((): Record<string, SerializedFileVisibility> => {
    const result: Record<string, SerializedFileVisibility> = {}
    visibilityMap.forEach((fileVisibility, filename) => {
      const fileSerialized = serializeFileVisibility(fileVisibility)
      if (Object.keys(fileSerialized).length > 0) {
        result[filename] = fileSerialized
      }
    })
    return result
  }, [visibilityMap])

  // Summary stats
  const stats = useMemo(() => {
    let totalHidden = 0
    let filesWithHidden = 0
    
    visibilityMap.forEach(fileVisibility => {
      const fileCount = countFileHidden(fileVisibility)
      if (fileCount > 0) {
        filesWithHidden++
        totalHidden += fileCount
      }
    })
    
    return {
      filesWithHidden,
      totalHiddenItems: totalHidden,
    }
  }, [visibilityMap])

  return {
    // Sheet-scoped methods (recommended)
    getSheetVisibility,
    setSheetVisibility,
    getFileVisibility,
    setFileVisibility,
    getSerializedSheetVisibility,
    
    // Backward-compatible methods
    getVisibility,
    setVisibility,
    
    // Common methods
    clearVisibility,
    clearAllVisibility,
    getAllSerializedVisibility,
    stats,
  }
}