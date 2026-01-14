import { useState, useCallback, useMemo } from 'react'

// ============================================================================
// Types - Sheet-scoped with WHITELIST support
// ============================================================================

/**
 * Visibility state for a single sheet within a file.
 * 
 * hidden* = extra items to hide (beyond default numeric hiding)
 * visible* = items to SHOW (overrides default numeric hiding - whitelist)
 */
export interface SheetVisibilityState {
  hiddenColumns: Set<string>
  hiddenRows: Set<number>
  hiddenCells: Set<string>
  // Whitelist - explicitly show these (overrides default numeric hiding)
  visibleColumns: Set<string>
  visibleRows: Set<number>
  visibleCells: Set<string>
}

export interface FileVisibilityState {
  [sheetName: string]: SheetVisibilityState
}

export interface SerializedSheetVisibility {
  hiddenColumns: string[]
  hiddenRows: number[]
  hiddenCells: string[]
  visibleColumns?: string[]
  visibleRows?: number[]
  visibleCells?: string[]
}

export interface SerializedFileVisibility {
  [sheetName: string]: SerializedSheetVisibility
}

// For backward compatibility
export type VisibilityState = SheetVisibilityState
export type SerializedVisibility = SerializedSheetVisibility

type FileVisibilityMap = Map<string, FileVisibilityState>

// ============================================================================
// Helpers
// ============================================================================

export function createEmptySheetVisibility(): SheetVisibilityState {
  return {
    hiddenColumns: new Set(),
    hiddenRows: new Set(),
    hiddenCells: new Set(),
    visibleColumns: new Set(),
    visibleRows: new Set(),
    visibleCells: new Set(),
  }
}

function createEmptyFileVisibility(): FileVisibilityState {
  return {}
}

export function serializeSheetVisibility(visibility: SheetVisibilityState): SerializedSheetVisibility {
  const result: SerializedSheetVisibility = {
    hiddenColumns: [...visibility.hiddenColumns],
    hiddenRows: [...visibility.hiddenRows],
    hiddenCells: [...visibility.hiddenCells],
  }
  // Only include visible* if they have items
  if (visibility.visibleColumns?.size > 0) result.visibleColumns = [...visibility.visibleColumns]
  if (visibility.visibleRows?.size > 0) result.visibleRows = [...visibility.visibleRows]
  if (visibility.visibleCells?.size > 0) result.visibleCells = [...visibility.visibleCells]
  return result
}

export function deserializeSheetVisibility(data: SerializedSheetVisibility): SheetVisibilityState {
  return {
    hiddenColumns: new Set(data.hiddenColumns || []),
    hiddenRows: new Set(data.hiddenRows || []),
    hiddenCells: new Set(data.hiddenCells || []),
    visibleColumns: new Set(data.visibleColumns || []),
    visibleRows: new Set(data.visibleRows || []),
    visibleCells: new Set(data.visibleCells || []),
  }
}

export function serializeFileVisibility(fileVisibility: FileVisibilityState): SerializedFileVisibility {
  const result: SerializedFileVisibility = {}
  for (const [sheetName, sheetVis] of Object.entries(fileVisibility)) {
    const serialized = serializeSheetVisibility(sheetVis)
    const hasHidden = serialized.hiddenColumns.length > 0 || serialized.hiddenRows.length > 0 || serialized.hiddenCells.length > 0
    const hasVisible = (serialized.visibleColumns?.length || 0) > 0 || (serialized.visibleRows?.length || 0) > 0 || (serialized.visibleCells?.length || 0) > 0
    if (hasHidden || hasVisible) {
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

// Ensure a visibility object has all required fields
export function ensureVisibilityFields(vis: Partial<SheetVisibilityState>): SheetVisibilityState {
  return {
    hiddenColumns: vis.hiddenColumns ?? new Set(),
    hiddenRows: vis.hiddenRows ?? new Set(),
    hiddenCells: vis.hiddenCells ?? new Set(),
    visibleColumns: vis.visibleColumns ?? new Set(),
    visibleRows: vis.visibleRows ?? new Set(),
    visibleCells: vis.visibleCells ?? new Set(),
  }
}

/**
 * Check if a cell is user-hidden (extra hidden, beyond default)
 */
export function isCellUserHidden(cellAddr: string, visibility: SheetVisibilityState): boolean {
  if (visibility.hiddenCells?.has(cellAddr)) return true
  const match = cellAddr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return false
  const [, col, rowStr] = match
  const row = parseInt(rowStr, 10)
  if (visibility.hiddenColumns?.has(col)) return true
  if (visibility.hiddenRows?.has(row)) return true
  return false
}

/**
 * Check if a cell is whitelisted (shown despite being numeric)
 */
export function isCellWhitelisted(cellAddr: string, visibility: SheetVisibilityState): boolean {
  if (visibility.visibleCells?.has(cellAddr)) return true
  const match = cellAddr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return false
  const [, col, rowStr] = match
  const row = parseInt(rowStr, 10)
  if (visibility.visibleColumns?.has(col)) return true
  if (visibility.visibleRows?.has(row)) return true
  return false
}

function countSheetHidden(visibility: SheetVisibilityState): number {
  return (visibility.hiddenColumns?.size || 0) + (visibility.hiddenRows?.size || 0) + (visibility.hiddenCells?.size || 0)
}

function countSheetVisible(visibility: SheetVisibilityState): number {
  return (visibility.visibleColumns?.size || 0) + (visibility.visibleRows?.size || 0) + (visibility.visibleCells?.size || 0)
}

function countFileHidden(fileVisibility: FileVisibilityState): number {
  return Object.values(fileVisibility).reduce((t, s) => t + countSheetHidden(s), 0)
}

function countFileVisible(fileVisibility: FileVisibilityState): number {
  return Object.values(fileVisibility).reduce((t, s) => t + countSheetVisible(s), 0)
}

// ============================================================================
// Hook
// ============================================================================

const STORAGE_KEY = 'roai_visibility_v4' // v4 for whitelist support

export function useVisibility() {
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
      
      // Migrate from v3
      const v3Saved = localStorage.getItem('roai_visibility_v3')
      if (v3Saved) {
        console.log('Migrating visibility from v3 to v4...')
        const parsed = JSON.parse(v3Saved) as Record<string, SerializedFileVisibility>
        const map = new Map<string, FileVisibilityState>()
        Object.entries(parsed).forEach(([filename, fileData]) => {
          map.set(filename, deserializeFileVisibility(fileData))
        })
        localStorage.setItem(STORAGE_KEY, v3Saved) // Same format, just with optional visible* fields
        localStorage.removeItem('roai_visibility_v3')
        return map
      }
    } catch (e) {
      console.error('Failed to load visibility state:', e)
    }
    return new Map()
  })

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

  const getSheetVisibility = useCallback((filename: string, sheetName: string): SheetVisibilityState => {
    const fileVis = visibilityMap.get(filename)
    if (!fileVis || !fileVis[sheetName]) {
      return createEmptySheetVisibility()
    }
    return ensureVisibilityFields(fileVis[sheetName])
  }, [visibilityMap])

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

  const getFileVisibility = useCallback((filename: string): FileVisibilityState => {
    const fileVis = visibilityMap.get(filename) ?? createEmptyFileVisibility()
    // Ensure all sheets have proper fields
    const result: FileVisibilityState = {}
    for (const [sheetName, sheetVis] of Object.entries(fileVis)) {
      result[sheetName] = ensureVisibilityFields(sheetVis)
    }
    return result
  }, [visibilityMap])

  const setFileVisibility = useCallback((filename: string, fileVis: FileVisibilityState) => {
    setVisibilityMap(prev => {
      const next = new Map(prev)
      next.set(filename, fileVis)
      saveToStorage(next)
      return next
    })
  }, [saveToStorage])

  const clearVisibility = useCallback((filename: string) => {
    setVisibilityMap(prev => {
      const next = new Map(prev)
      next.delete(filename)
      saveToStorage(next)
      return next
    })
  }, [saveToStorage])

  const clearAllVisibility = useCallback(() => {
    setVisibilityMap(new Map())
    localStorage.removeItem(STORAGE_KEY)
  }, [])

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

  const stats = useMemo(() => {
    let totalHidden = 0
    let totalVisible = 0
    let filesWithChanges = 0
    
    visibilityMap.forEach(fileVisibility => {
      const h = countFileHidden(fileVisibility)
      const v = countFileVisible(fileVisibility)
      if (h > 0 || v > 0) {
        filesWithChanges++
        totalHidden += h
        totalVisible += v
      }
    })
    
    return {
      filesWithHidden: filesWithChanges,
      totalHiddenItems: totalHidden,
      totalVisibleItems: totalVisible,
    }
  }, [visibilityMap])

  return {
    getSheetVisibility,
    setSheetVisibility,
    getFileVisibility,
    setFileVisibility,
    clearVisibility,
    clearAllVisibility,
    getAllSerializedVisibility,
    stats,
  }
}