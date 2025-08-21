'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { DatasetItem, Analytics, SortKey } from '@/components/types'
import { calculateAnalytics, executeExport } from '@/components/utils'
import { ExportModal } from '@/components/export-modal'
import { AnalyticsCards } from '@/components/analytics-cards'
import { GroupsSection } from '@/components/groups-section'
import { DatasetItemsList } from '@/components/dataset-items-list'
import { DashboardHeader } from '@/components/dashboard-header'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { AuthProvider, useAuth } from '@/components/auth-context'
import { AuthGate } from '@/components/auth-gate'

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

function DashboardContent() {
  const { status, headers: authHeaders, user } = useAuth()
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
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState<{ format: 'json' | 'csv' | 'jsonl'; keys: Set<keyof DatasetItem> }>({
    format: 'json',
    keys: new Set<keyof DatasetItem>()
  });
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const ttl = 60000
  const dsKey = `dataset:all:${user?.id || 'anon'}`

  const [importBusy, setImportBusy] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importFormat, setImportFormat] = useState<'csv' | 'jsonl' | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchItems()
    const urlParams = new URLSearchParams(window.location.search)
    const groupParam = urlParams.get('group')
    if (groupParam) setActiveGroup(groupParam)
  }, [status])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeGroup])

  const fetchItems = async () => {
    try {
      const cachedWrapper = readCache(dsKey)
      if (cachedWrapper) {
        const cachedList = toList(cachedWrapper)
        if (cachedList.length) {
          setItems(cachedList)
          calculateAnalyticsLocal(cachedList)
        }
      }
      const response = await fetch('/api/dataset', { cache: 'no-store', headers: { ...authHeaders() } })
      if (response.ok) {
        const payload = await response.json()
        const list = toList(payload)
        setItems(list)
        calculateAnalyticsLocal(list)
        writeCache(dsKey, list)
      }
    } catch (error) {
      setLoading(false)
    } finally {
      setLoading(false)
    }
  }

  const handleAssignGroup = async (itemId: string, group: string | null) => {
    const originalItem = items.find(item => item.id === itemId);
    if (!originalItem) return;
    const originalGroup = originalItem.group || null;
    const newGroup = group || null;
    if (originalGroup === newGroup) return;
    const updatedItem = { ...originalItem, group: newGroup };
    setItems(prevItems =>
      prevItems.map(item =>
        item.id === itemId ? updatedItem : item
      )
    );
    updateDatasetCacheItem(updatedItem)
    try {
      await fetch(`/api/dataset/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(updatedItem),
      })
    } catch {
      setItems(prevItems =>
        prevItems.map(item =>
          item.id === itemId ? originalItem : item
        )
      );
      updateDatasetCacheItem(originalItem)
    }
  }

  const calculateAnalyticsLocal = (data: DatasetItem[]) => {
    const list = toList(data)
    const analyticsResult = calculateAnalytics(list)
    setAnalytics(analyticsResult)
  }

  const handleSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const uniqueGroups = useMemo(() => {
    const allGroups = items.map(item => item.group).filter((g): g is string => !!g);
    return Array.from(new Set(allGroups)).sort();
  }, [items]);

  const sortedItems = useMemo(() => {
    let sortableItems: DatasetItem[];
    if (activeGroup === 'Ungrouped') {
      sortableItems = items.filter(item => !item.group || item.group.trim() === '');
    } else if (activeGroup) {
      sortableItems = items.filter(item => item.group === activeGroup);
    } else {
      sortableItems = [...items];
    }
    const { key, direction } = sortConfig;
    sortableItems.sort((a, b) => {
      let aValue: any;
      let bValue: any;
      if (key === 'lastRunSuccessful') {
        aValue = a.lastRunSuccessful;
        bValue = b.lastRunSuccessful;
      } else if (key === 'difficulty') {
        const difficultyOrder = { 'Easy': 1, 'Medium': 2, 'Hard': 3 };
        aValue = difficultyOrder[a.difficulty] || 0;
        bValue = difficultyOrder[b.difficulty] || 0;
      } else {
        aValue = a[key];
        bValue = b[key];
      }
      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sortableItems;
  }, [items, sortConfig, activeGroup]);

  const handleSelection = (id: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(id)) {
      newSelectedIds.delete(id);
    } else {
      newSelectedIds.add(id);
    }
    setSelectedIds(newSelectedIds);
  };
  
  const handleSelectAll = () => {
    const currentItems = sortedItems;
    const currentItemIds = new Set(currentItems.map(item => item.id));
    if (selectedIds.size === currentItems.length && currentItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(currentItemIds);
    }
  };

  const openExportDialog = (format: 'json' | 'csv' | 'jsonl') => {
    const allKeys = items.length > 0 ? Object.keys(items[0]) as Array<keyof DatasetItem> : [];
    setExportOptions({
      format,
      keys: new Set(allKeys)
    });
    setIsExportModalOpen(true);
  };

  const handleExportKeyToggle = (key: keyof DatasetItem) => {
    setExportOptions(prev => {
      const newKeys = new Set(prev.keys);
      if (newKeys.has(key)) {
        newKeys.delete(key);
      } else {
        newKeys.add(key);
      }
      return { ...prev, keys: newKeys };
    });
  };

  const executeExportLocal = () => {
    executeExport(items, selectedIds, exportOptions)
    setIsExportModalOpen(false);
  }

  const parseCsv = (text: string): Record<string, string>[] => {
    const rows: string[][] = []
    let field = ''
    let row: string[] = []
    let inQuotes = false
    let i = 0
    while (i < text.length) {
      const c = text[i]
      if (inQuotes) {
        if (c === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"'
            i += 2
            continue
          } else {
            inQuotes = false
            i++
            continue
          }
        } else {
          field += c
          i++
          continue
        }
      } else {
        if (c === '"') {
          inQuotes = true
          i++
          continue
        }
        if (c === ',') {
          row.push(field)
          field = ''
          i++
          continue
        }
        if (c === '\r') {
          i++
          continue
        }
        if (c === '\n') {
          row.push(field)
          rows.push(row)
          row = []
          field = ''
          i++
          continue
        }
        field += c
        i++
        continue
      }
    }
    row.push(field)
    rows.push(row)
    if (rows.length === 0) return []
    const headers = rows[0].map(h => h.trim())
    const out: Record<string, string>[] = []
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r]
      if (cols.length === 1 && cols[0].trim() === '') continue
      const obj: Record<string, string> = {}
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = cols[j] ?? ''
      }
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
      try {
        return fromTaskObject(JSON.parse(jt))
      } catch {
        try {
          return fromTaskObject(JSON.parse(jt.replace(/""/g, '"')))
        } catch {}
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
      try {
        const obj = JSON.parse(line)
        out.push(fromTaskObject(obj))
      } catch {}
    }
    return out
  }

  const createItem = async (payload: Partial<DatasetItem>) => {
    const res = await fetch('/api/dataset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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
      setItems(next)
      writeCache(dsKey, next)
      calculateAnalyticsLocal(next)
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
    setItems(next)
    writeCache(dsKey, next)
    calculateAnalyticsLocal(next)
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
        headers: { ...authHeaders() },
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
      const list = Array.isArray(created) ? created as DatasetItem[] : toList(created)
      const next = [...items, ...list]
      setItems(next)
      writeCache(dsKey, next)
      calculateAnalyticsLocal(next)
      setImportProgress({ done: 1, total: 1 })
    } catch (e: any) {
      setImportErrors([String(e?.message || e)])
    } finally {
      setImportBusy(false)
    }
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !importFormat) return
    await uploadAndImportFile(importFormat, f)
    setFileInputKey(v => v + 1)
  }

  const triggerImport = (fmt: 'csv' | 'jsonl') => {
    setImportFormat(fmt)
    setFileInputKey(v => v + 1)
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  if (loading) {
    return <LoadingState />
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        items={items}
        selectedIds={selectedIds}
        exportOptions={exportOptions}
        onExportKeyToggle={handleExportKeyToggle}
        onExecuteExport={executeExportLocal}
      />
      
      <DashboardHeader onOpenExportDialog={openExportDialog} />

      <div className="flex items-center gap-2">
        <input
          key={fileInputKey}
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelected}
          accept={importFormat === 'csv' ? '.csv,text/csv' : '.jsonl,.json,text/plain,application/json'}
          className="hidden"
        />
        <Button size="sm" variant="outline" onClick={() => triggerImport('csv')}>Import CSV</Button>
        <Button size="sm" variant="outline" onClick={() => triggerImport('jsonl')}>Import JSONL</Button>
        {importBusy ? <span className="text-sm text-muted-foreground">{importProgress.done}/{importProgress.total}</span> : null}
        {!importBusy && importErrors.length > 0 ? <span className="text-sm text-red-500">{importErrors.length} failed</span> : null}
      </div>
      
      <AnalyticsCards analytics={analytics} />
      
      <GroupsSection
        items={items}
        activeGroup={activeGroup}
        onGroupChange={setActiveGroup}
      />
      
      <DatasetItemsList
        items={items}
        sortedItems={sortedItems}
        selectedIds={selectedIds}
        sortConfig={sortConfig}
        activeGroup={activeGroup}
        uniqueGroups={uniqueGroups}
        onSelectionChange={handleSelection}
        onSelectAll={handleSelectAll}
        onSort={handleSort}
        onAssignGroup={handleAssignGroup}
      />
    </div>
  )
}

export default function Dashboard() {
  return (
    <AuthProvider>
      <AuthGate>
        <DashboardContent />
      </AuthGate>
    </AuthProvider>
  )
}
