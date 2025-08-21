// components/dashboard/useDatasetDashboard.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { DatasetItem, Analytics, SortKey } from '@/components/types'
import { calculateAnalytics, executeExport } from '@/components/utils'
import { useAuth } from '@/components/auth-context'

type ExportFormat = 'json' | 'csv' | 'jsonl'

const toList = (payload: any): DatasetItem[] => {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.data)) return payload.data
  if (payload && Array.isArray(payload.items)) return payload.items
  if (payload && typeof payload.ts === 'number' && Array.isArray(payload.data)) return payload.data
  return []
}

const normDifficulty = (v: any): 'Easy' | 'Medium' | 'Hard' => {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'easy') return 'Easy'
  if (s === 'medium') return 'Medium'
  if (s === 'hard') return 'Hard'
  return 'Easy'
}

const toTopics = (t: any): string[] => {
  if (Array.isArray(t)) return t.map(x => String(x)).filter(Boolean)
  if (typeof t === 'string') return t.split(/[;,]/).map(s => s.trim()).filter(Boolean)
  return []
}

const normalizeForCreate = (p: Partial<DatasetItem>): Partial<DatasetItem> => {
  return {
    prompt: String(p.prompt ?? ''),
    inputs: String(p.inputs ?? ''),
    outputs: String(p.outputs ?? ''),
    unit_tests: String(p.unit_tests ?? ''),
    solution: String(p.solution ?? ''),
    code_file: p.code_file ? String(p.code_file) : '',
    language: p.language ? String(p.language) : undefined,
    group: p.group === '' ? null : p.group ?? null,
    time_complexity: String(p.time_complexity ?? ''),
    space_complexity: String(p.space_complexity ?? ''),
    topics: toTopics(p.topics),
    difficulty: normDifficulty((p as any).difficulty),
    notes: String(p.notes ?? '')
  }
}

/** Works whether `headers` from auth-context is a function or a plain object */
const makeAuthHeaderGetter = (authHeadersMaybeFn: any) => {
  return () => {
    try {
      if (typeof authHeadersMaybeFn === 'function') {
        const v = authHeadersMaybeFn()
        return v && typeof v === 'object' ? v : {}
      }
      return authHeadersMaybeFn && typeof authHeadersMaybeFn === 'object' ? authHeadersMaybeFn : {}
    } catch {
      return {}
    }
  }
}

export function useDatasetDashboard() {
  const { status, headers: authHeaders, user } = useAuth()
  const getAuthHeaders = useMemo(() => makeAuthHeaderGetter(authHeaders), [authHeaders])

  const [items, setItems] = useState<DatasetItem[]>([])
  const [analytics, setAnalytics] = useState<Analytics>({
    totalItems: 0,
    byDifficulty: {},
    byTopic: {},
    successfulRuns: 0,
    itemsWithNotes: 0
  })
  const [loading, setLoading] = useState(true)

  const [selectedIds, setSelectedIds] = useState(new Set<string>())
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' })
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  // Export modal
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState<{ format: ExportFormat; keys: Set<keyof DatasetItem> }>({
    format: 'json',
    keys: new Set<keyof DatasetItem>()
  })

  // Import UI state
  const [importBusy, setImportBusy] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importFormat, setImportFormat] = useState<'csv' | 'jsonl' | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const ttl = 60_000
  const dsKey = `dataset:all:${user?.id || 'anon'}`

  const readCache = (k: string) => {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem(k)
    if (!raw) return null
    try {
      const j = JSON.parse(raw)
      if (!j || !j.ts || !j.data) return null
      if (Date.now() - j.ts > ttl) {
        sessionStorage.removeItem(k)
        return null
      }
      return j
    } catch {
      sessionStorage.removeItem(k)
      return null
    }
  }

  const writeCache = (k: string, data: DatasetItem[]) => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), data }))
  }

  const updateDatasetCacheItem = (updated: DatasetItem) => {
    const wrapper = readCache(dsKey)
    if (!wrapper) return
    const list = toList(wrapper)
    const idx = list.findIndex(x => x.id === updated.id)
    if (idx >= 0) {
      const next = [...list]
      next[idx] = { ...next[idx], ...updated }
      writeCache(dsKey, next)
    }
  }

  const calculateAnalyticsLocal = (data: DatasetItem[]) => {
    const list = toList(data)
    const analyticsResult = calculateAnalytics(list)
    setAnalytics(analyticsResult)
  }

  /** Always promote the head version's snapshot into the list item */
  const mergeHeadSnapshots = async (list: DatasetItem[]) => {
    if (!list.length) return list
    const getHeaders = getAuthHeaders
    const out: DatasetItem[] = Array.from(list)
    let i = 0
    const limit = 6
    const worker = async () => {
      for (;;) {
        const idx = i++
        if (idx >= list.length) return
        const it = list[idx]
        if (!it?.currentVersionId) {
          out[idx] = it
          continue
        }
        try {
          const res = await fetch(`/api/dataset/${it.id}/versions/${it.currentVersionId}`, {
            cache: 'no-store',
            headers: { ...getHeaders() }
          })
          if (!res.ok) {
            out[idx] = it
            continue
          }
          const v = await res.json().catch(() => null)
          const d = (v?.data || {}) as Partial<DatasetItem>
          out[idx] = { ...it, ...d }
        } catch {
          out[idx] = it
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()))
    return out
  }

  const fetchItems = async () => {
    setLoading(true)
    try {
      // Try cache first
      const cachedWrapper = readCache(dsKey)
      if (cachedWrapper) {
        const cachedList = toList(cachedWrapper)
        if (cachedList.length) {
          setItems(cachedList)
          calculateAnalyticsLocal(cachedList)
        }
      }

      // Fresh fetch (do NOT require authentication here)
      const res = await fetch('/api/dataset', { cache: 'no-store', headers: { ...getAuthHeaders() } })
      if (res.ok) {
        const payload = await res.json()
        const list = toList(payload)
        const merged = await mergeHeadSnapshots(list)
        setItems(merged)
        calculateAnalyticsLocal(merged)
        writeCache(dsKey, merged)
      }
    } catch {
      // swallow errors; show empty state
    } finally {
      setLoading(false)
    }
  }

  // Load once auth status is resolved (either authenticated or not)
  useEffect(() => {
    if (status === 'loading') return
    const urlParams = new URLSearchParams(window.location.search)
    const groupParam = urlParams.get('group')
    if (groupParam) setActiveGroup(groupParam)
    fetchItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  /** Assign group (optimistic) */
  const handleAssignGroup = async (itemId: string, group: string | null) => {
    const originalItem = items.find(i => i.id === itemId)
    if (!originalItem) return
    const newGroup = group || null
    if ((originalItem.group || null) === newGroup) return

    const updatedItem = { ...originalItem, group: newGroup }
    setItems(prev => prev.map(it => (it.id === itemId ? updatedItem : it)))
    updateDatasetCacheItem(updatedItem)

    try {
      await fetch(`/api/dataset/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ group: newGroup })
      })
    } catch {
      // rollback
      setItems(prev => prev.map(it => (it.id === itemId ? originalItem : it)))
      updateDatasetCacheItem(originalItem)
    }
  }

  /** Sorting and selection */
  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const handleSelection = (id: string) => {
    const next = new Set(selectedIds)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelectedIds(next)
  }

  const handleSelectAll = (currentItems: DatasetItem[]) => {
    const ids = new Set(currentItems.map(i => i.id))
    if (selectedIds.size === currentItems.length && currentItems.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(ids)
    }
  }

  const uniqueGroups = useMemo(() => {
    const allGroups = items.map(item => item.group).filter((g): g is string => !!g)
    return Array.from(new Set(allGroups)).sort()
  }, [items])

  const sortedItems = useMemo(() => {
    let source: DatasetItem[]
    if (activeGroup === 'Ungrouped') {
      source = items.filter(item => !item.group || item.group.trim() === '')
    } else if (activeGroup) {
      source = items.filter(item => item.group === activeGroup)
    } else {
      source = [...items]
    }
    const { key, direction } = sortConfig
    source.sort((a, b) => {
      let aValue: any
      let bValue: any
      if (key === 'lastRunSuccessful') {
        aValue = a.lastRunSuccessful
        bValue = b.lastRunSuccessful
      } else if (key === 'difficulty') {
        const order = { Easy: 1, Medium: 2, Hard: 3 } as any
        aValue = order[a.difficulty] || 0
        bValue = order[b.difficulty] || 0
      } else {
        aValue = (a as any)[key]
        bValue = (b as any)[key]
      }
      if (aValue < bValue) return direction === 'asc' ? -1 : 1
      if (aValue > bValue) return direction === 'asc' ? 1 : -1
      return 0
    })
    return source
  }, [items, sortConfig, activeGroup])

  /** Head-aware export helpers */
  const fetchHeadSnapshot = async (it: DatasetItem): Promise<DatasetItem> => {
    if (!it.currentVersionId) return it
    try {
      const res = await fetch(`/api/dataset/${it.id}/versions/${it.currentVersionId}`, {
        cache: 'no-store',
        headers: { ...getAuthHeaders() }
      })
      if (!res.ok) return it
      const v = await res.json().catch(() => null)
      const d = (v?.data || {}) as Partial<DatasetItem>
      return { ...it, ...d }
    } catch {
      return it
    }
  }

  const prepareItemsForExport = async (base: DatasetItem[], ids: Set<string>) => {
    const targets = ids.size ? base.filter(i => ids.has(i.id)) : base
    const limit = 6
    const out: DatasetItem[] = []
    let idx = 0
    const worker = async () => {
      for (;;) {
        const i = idx++
        if (i >= targets.length) return
        const snap = await fetchHeadSnapshot(targets[i])
        out[i] = snap
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, () => worker()))
    if (!ids.size) return out
    const map = new Map(out.map(x => [x.id, x]))
    return base.map(x => map.get(x.id) || x)
  }

  const openExportDialog = (format: ExportFormat) => {
    const allKeys = items.length > 0 ? (Object.keys(items[0]) as Array<keyof DatasetItem>) : []
    setExportOptions({ format, keys: new Set(allKeys) })
    setIsExportModalOpen(true)
  }

  const onExportKeyToggle = (key: keyof DatasetItem) => {
    setExportOptions(prev => {
      const keys = new Set(prev.keys)
      keys.has(key) ? keys.delete(key) : keys.add(key)
      return { ...prev, keys }
    })
  }

  const executeExportLocal = async () => {
    const headAware = await prepareItemsForExport(items, selectedIds)
    executeExport(headAware, selectedIds, exportOptions)
    setIsExportModalOpen(false)
  }

  /** Imports */
  const parseCsv = (text: string): Record<string, string>[] => {
    const rows: string[][] = []
    let field = '', row: string[] = []
    let inQuotes = false
    let i = 0
    while (i < text.length) {
      const c = text[i]
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2; continue }
          inQuotes = false; i++; continue
        }
        field += c; i++; continue
      } else {
        if (c === '"') { inQuotes = true; i++; continue }
        if (c === ',') { row.push(field); field = ''; i++; continue }
        if (c === '\r') { i++; continue }
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
        field += c; i++; continue
      }
    }
    row.push(field); rows.push(row)
    if (rows.length === 0) return []
    const headers = rows[0].map(h => h.trim())
    const out: Record<string, string>[] = []
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r]
      if (cols.length === 1 && cols[0].trim() === '') continue
      const obj: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) obj[headers[j]] = cols[j] ?? ''
      out.push(obj)
    }
    return out
  }

  const fromTaskObject = (o: any): Partial<DatasetItem> => {
    const meta = o?.metadata || {}
    return normalizeForCreate({
      prompt: o?.prompt || '',
      inputs: o?.inputs || '',
      outputs: o?.outputs || '',
      code_file: o?.code_file || '',
      solution: o?.reference_solution ?? o?.solution ?? '',
      unit_tests: o?.unit_tests || '',
      language: o?.language,
      difficulty: meta?.difficulty || o?.difficulty || 'Easy',
      topics: meta?.topics || o?.topics,
      time_complexity: meta?.time_complexity || o?.time_complexity || '',
      space_complexity: meta?.space_complexity || o?.space_complexity || '',
      notes: o?.notes || '',
      group: o?.group ?? null
    })
  }

  const mapCsvRow = (row: Record<string, string>): Partial<DatasetItem> => {
    const clean = (v: string | undefined) => (v ?? '').replace(/""/g, '"')
    const jt = clean(row['full_task_json'])
    if (jt) {
      try { return fromTaskObject(JSON.parse(jt)) } catch {
        try { return fromTaskObject(JSON.parse(jt.replace(/""/g, '"'))) } catch {}
      }
    }
    return normalizeForCreate({
      prompt: clean(row['prompt']),
      inputs: clean(row['inputs']),
      outputs: clean(row['outputs']),
      code_file: clean(row['code_file']),
      solution: clean(row['reference_solution'] || row['solution']),
      unit_tests: clean(row['unit_tests']),
      language: clean(row['language']) || undefined,
      difficulty: normDifficulty(clean(row['difficulty'])),
      topics: toTopics(clean(row['topics'])),
      time_complexity: clean(row['time_complexity']),
      space_complexity: clean(row['space_complexity']),
      notes: clean(row['notes']),
      group: row['group'] ? clean(row['group']) : null
    })
  }

  const parseJsonl = (text: string): Partial<DatasetItem>[] => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const out: Partial<DatasetItem>[] = []
    for (const line of lines) {
      try { out.push(fromTaskObject(JSON.parse(line))) } catch {}
    }
    return out
  }

  const createItem = async (payload: Partial<DatasetItem>) => {
    const res = await fetch('/api/dataset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      let msg = ''
      try { msg = await res.text() } catch {}
      throw new Error(msg || `HTTP ${res.status}`)
    }
    return await res.json()
  }

  const tryBulk = async (payloads: Partial<DatasetItem>[]) => {
    const res = await fetch('/api/dataset/_bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ items: payloads })
    })
    if (!res.ok) return null
    try {
      const json = await res.json()
      if (Array.isArray(json)) return json as DatasetItem[]
      if (Array.isArray(json?.items)) return json.items as DatasetItem[]
      return null
    } catch {
      return null
    }
  }

  const importPayloads = async (payloadsIn: Partial<DatasetItem>[]) => {
    const payloads = payloadsIn.map(normalizeForCreate)
    setImportBusy(true)
    setImportErrors([])
    setImportProgress({ done: 0, total: payloads.length })
    const bulk = await tryBulk(payloads)
    if (bulk && bulk.length) {
      const next = [...items, ...bulk]
      setItems(next); writeCache(dsKey, next); calculateAnalyticsLocal(next)
      setImportBusy(false)
      return
    }
    const results: DatasetItem[] = []
    let index = 0
    const limit = 2
    const worker = async () => {
      for (;;) {
        const i = index++
        if (i >= payloads.length) return
        let attempt = 0
        for (;;) {
          try {
            const created = await createItem(payloads[i])
            results.push(created)
            setImportProgress(p => ({ done: p.done + 1, total: p.total }))
            break
          } catch (e: any) {
            attempt++
            if (attempt >= 3) {
              setImportProgress(p => ({ done: p.done + 1, total: p.total }))
              setImportErrors(prev => [...prev, String(e?.message || e)])
              break
            }
            await new Promise(r => setTimeout(r, 400 * attempt))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, payloads.length) }, () => worker()))
    const next = [...items, ...results]
    setItems(next); writeCache(dsKey, next); calculateAnalyticsLocal(next)
    setImportBusy(false)
  }

  const uploadAndImportFile = async (fmt: 'csv' | 'jsonl', f: File) => {
    setImportBusy(true)
    setImportErrors([])
    setImportProgress({ done: 0, total: 1 })
    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch(`/api/dataset/import/${fmt}`, {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: fd
      })
      if (!res.ok) {
        let msg = ''
        try { msg = await res.text() } catch {}
        setImportErrors([msg || `HTTP ${res.status}`])
        setImportBusy(false)
        return
      }
      const created = await res.json()
      const list = Array.isArray(created) ? (created as DatasetItem[]) : toList(created)
      const merged = await mergeHeadSnapshots(list)
      const next = [...items, ...merged]
      setItems(next); writeCache(dsKey, next); calculateAnalyticsLocal(next)
      setImportProgress({ done: 1, total: 1 })
    } catch (e: any) {
      setImportErrors([String(e?.message || e)])
    } finally {
      setImportBusy(false)
    }
  }

  const triggerImport = (fmt: 'csv' | 'jsonl') => {
    setImportFormat(fmt)
    setFileInputKey(v => v + 1)
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !importFormat) return
    await uploadAndImportFile(importFormat, f)
    setFileInputKey(v => v + 1)
  }

  return {
    // data
    items, setItems,
    analytics, loading,
    selectedIds, setSelectedIds,
    sortConfig, setSortConfig,
    activeGroup, setActiveGroup,
    uniqueGroups,
    isExportModalOpen, setIsExportModalOpen,
    exportOptions, setExportOptions,

    // derived
    sortedItems,

    // actions
    handleSort,
    handleSelection,
    handleSelectAll,
    handleAssignGroup,
    openExportDialog,
    onExportKeyToggle,
    executeExportLocal,

    // import UI
    importBusy, importErrors, importProgress,
    triggerImport, fileInputRef, fileInputKey, handleFileSelected
  }
}
