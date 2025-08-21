'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, Save, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import Link from 'next/link'
import TestExecutionPanel from '@/components/TestExecutionPanel'
import CodeEditorPanel from '@/components/CodeEditorPanel'
import TopicsEditor from '@/components/TopicsEditor'
import { clearCommentsAndDocstrings } from '@/components/utils'
import { useAutoResize } from '@/components/useAutoResize'
import { DatasetItem } from '@/components/types'

interface TestResult {
  success: boolean
  output: string
  error?: string
  timeout?: boolean
}

interface VersionNode {
  id: string
  itemId?: string
  parentId?: string | null
  label?: string | null
  data?: Partial<DatasetItem>
  authorId?: string | null
  createdAt?: string
}

export default function ReviewItem() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const [groupContext, setGroupContext] = useState<{ group: string | null; groupName: string | null; }>({ group: null, groupName: null })
  const [item, setItem] = useState<DatasetItem | null>(null)
  const [allItems, setAllItems] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isSuggestingTopics, setIsSuggestingTopics] = useState(false)
  const { resizeTextarea, handleAutoResize } = useAutoResize()
  const [versions, setVersions] = useState<VersionNode[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [versionLabel, setVersionLabel] = useState('')

  const ttl = 60000
  const dsKey = 'dataset:all'

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
      return j.data
    } catch {
      sessionStorage.removeItem(k)
      return null
    }
  }

  const writeCache = (k: string, data: any) => {
    if (typeof window === 'undefined') return
    sessionStorage.setItem(k, JSON.stringify({ ts: Date.now(), data }))
  }

  const updateDatasetCacheItem = (updated: DatasetItem) => {
    const cached = readCache(dsKey)
    if (!cached || !Array.isArray(cached)) return
    const idx = cached.findIndex((x: any) => x.id === updated.id)
    if (idx >= 0) {
      const next = [...cached]
      next[idx] = { ...next[idx], ...updated }
      writeCache(dsKey, next)
    }
  }

  const loadDatasetList = async (): Promise<DatasetItem[]> => {
    const cached = readCache(dsKey)
    if (cached) return cached as DatasetItem[]
    const res = await fetch('/api/dataset', { cache: 'no-store' })
    const data = await res.json()
    if (Array.isArray(data)) writeCache(dsKey, data)
    return data
  }

  const applyVersionData = (d: Partial<DatasetItem>, markDirty: boolean) => {
    setItem(prev => {
      if (!prev) return prev
      return {
        ...prev,
        prompt: d.prompt || '',
        inputs: d.inputs || '',
        outputs: d.outputs || '',
        code_file: d.code_file || '',
        unit_tests: d.unit_tests || '',
        solution: d.solution || '',
        time_complexity: d.time_complexity || '',
        space_complexity: d.space_complexity || '',
        topics: Array.isArray(d.topics) ? (d.topics as string[]) : [],
        difficulty: (d.difficulty as any) || prev.difficulty,
        notes: d.notes ?? prev.notes
      }
    })
    if (markDirty) setHasUnsavedChanges(true)
  }

  const fetchVersions = async (itemId: string, headId: string | null, preloadIntoEditor: boolean) => {
    const res = await fetch(`/api/dataset/${itemId}/versions`, { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const flat = (data.flat || []) as VersionNode[]
    setVersions(flat)
    const head = headId || (flat.length ? flat[flat.length - 1].id : null)
    setSelectedVersionId(head || null)
    if (preloadIntoEditor && head) {
      const headNode = flat.find(v => v.id === head)
      if (headNode && headNode.data) applyVersionData(headNode.data, false)
    }
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const groupParam = urlParams.get('group')
    const init = async () => {
      try {
        if (groupParam) setGroupContext({ group: groupParam, groupName: groupParam })
        const list = await loadDatasetList()
        let filtered: DatasetItem[] = list
        if (groupParam === 'Ungrouped') {
          filtered = list.filter((x: DatasetItem) => !x.group || x.group.trim() === '')
        } else if (groupParam) {
          filtered = list.filter((x: DatasetItem) => x.group === groupParam)
        }
        const ids = filtered.map(x => x.id)
        setAllItems(ids)
        const idx = ids.indexOf(id)
        if (idx !== -1) {
          setCurrentIndex(idx)
          const fromList = filtered.find(x => x.id === id) as DatasetItem | undefined
          if (fromList) setItem(fromList)
          let fresh: DatasetItem | null = null
          try {
            const itemRes = await fetch(`/api/dataset/${id}`, { cache: 'no-store' })
            if (itemRes.ok) {
              const itemData = await itemRes.json()
              fresh = itemData
              setItem(itemData)
              updateDatasetCacheItem(itemData)
            }
          } catch {}
          const base = fresh || fromList || null
          await fetchVersions(id, base?.currentVersionId || null, true)
        }
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [id, router])

  useEffect(() => {
    if (item) {
      setTimeout(() => {
        resizeTextarea(document.getElementById('prompt') as HTMLTextAreaElement)
        resizeTextarea(document.getElementById('inputs') as HTMLTextAreaElement)
        resizeTextarea(document.getElementById('outputs') as HTMLTextAreaElement)
        resizeTextarea(document.getElementById('notes') as HTMLTextAreaElement)
        resizeTextarea(document.getElementById('time_complexity') as HTMLTextAreaElement)
        resizeTextarea(document.getElementById('space_complexity') as HTMLTextAreaElement)
      }, 0)
    }
  }, [item, resizeTextarea])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        if (hasUnsavedChanges && !saving) {
          handleSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [item, hasUnsavedChanges, saving])

  const loadVersion = async (versionId: string, markDirty: boolean = true) => {
    if (!versionId) return
    const inLocal = versions.find(v => v.id === versionId)
    if (inLocal && inLocal.data) {
      applyVersionData(inLocal.data, markDirty)
      return
    }
    const res = await fetch(`/api/dataset/${id}/versions/${versionId}`, { cache: 'no-store' })
    if (!res.ok) return
    const v = await res.json()
    const d = (v.data || {}) as Partial<DatasetItem>
    applyVersionData(d, markDirty)
  }

  const setHeadVersion = async () => {
    if (!item || !selectedVersionId) return
    const res = await fetch(`/api/dataset/${item.id}/head`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: selectedVersionId })
    })
    if (res.ok) {
      const updated = await res.json()
      setItem(updated)
      updateDatasetCacheItem(updated)
    }
  }

  const createVersion = async () => {
    if (!item) return
    const snapshot = {
      prompt: item.prompt || '',
      inputs: item.inputs || '',
      outputs: item.outputs || '',
      code_file: item.code_file || '',
      unit_tests: item.unit_tests || '',
      solution: item.solution || '',
      time_complexity: item.time_complexity || '',
      space_complexity: item.space_complexity || '',
      topics: item.topics || [],
      difficulty: item.difficulty || 'Easy',
      notes: item.notes || ''
    }
    const res = await fetch(`/api/dataset/${item.id}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: snapshot,
        parentId: selectedVersionId || item.currentVersionId || null,
        label: versionLabel || `v${versions.length + 1}`
      })
    })
    if (!res.ok) return
    const created = await res.json()
    setVersions(prev => [...prev, { id: created.id, itemId: item.id, parentId: created.parentId, label: created.label, data: snapshot, authorId: created.authorId, createdAt: created.createdAt }])
    setSelectedVersionId(created.id)
    setVersionLabel('')
    const headRes = await fetch(`/api/dataset/${item.id}/head`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: created.id })
    })
    if (headRes.ok) {
      const updated = await headRes.json()
      setItem(updated)
      updateDatasetCacheItem(updated)
    }
  }

  const handleSave = async () => {
    if (!item) return
    setSaving(true)
    try {
      const response = await fetch(`/api/dataset/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (response.ok) {
        const updatedItem = await response.json()
        setItem(updatedItem)
        setHasUnsavedChanges(false)
        updateDatasetCacheItem(updatedItem)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!item || !confirm('Are you sure you want to delete this item?')) return
    try {
      const response = await fetch(`/api/dataset/${item.id}`, { method: 'DELETE' })
      if (response.ok) {
        const cached = readCache(dsKey)
        if (cached && Array.isArray(cached)) {
          writeCache(dsKey, (cached as any[]).filter(x => x.id !== item.id))
        }
        router.push('/')
      }
    } catch {}
  }

  const runTests = async () => {
    if (!item) return
    setRunning(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/run-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: item.solution, tests: item.unit_tests }),
      })
      const result = await response.json()
      setTestResult(result)
      const updatedItem = { ...item, lastRunSuccessful: result.success }
      setItem(updatedItem)
      setHasUnsavedChanges(true)
    } catch {
      setTestResult({ success: false, output: '', error: 'Failed to run tests' })
    } finally {
      setRunning(false)
    }
  }

  const navigateToItem = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
    if (newIndex >= 0 && newIndex < allItems.length) {
      const groupQuery = groupContext.group ? `?group=${encodeURIComponent(groupContext.group)}` : ''
      router.push(`/review/${allItems[newIndex]}${groupQuery}`)
    }
  }

  const updateItem = (updates: Partial<DatasetItem>) => {
    if (!item) return
    const newUpdates = { ...updates }
    if ('solution' in updates || 'unit_tests' in updates) {
      ;(newUpdates as any).lastRunSuccessful = false
    }
    setItem(prev => prev ? { ...prev, ...newUpdates } : null)
    setHasUnsavedChanges(true)
  }

  const addTopic = () => {
    if (newTopic.trim() && item && !item.topics.includes(newTopic.trim())) {
      updateItem({ topics: [...item.topics, newTopic.trim()] })
      setNewTopic('')
    }
  }

  const removeTopic = (topicToRemove: string) => {
    if (!item) return
    updateItem({ topics: item.topics.filter(topic => topic !== topicToRemove) })
  }
  
  const suggestTopics = async () => {
    if (!item?.prompt || !item?.solution || isSuggestingTopics) return
    setIsSuggestingTopics(true)
    try {
      const response = await fetch('/api/suggest-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: item.prompt, solution: item.solution }),
      })
      if (!response.ok) throw new Error()
      const data = await response.json()
      const suggestedTopics = data.topics || []
      const newTopics = Array.from(new Set([...(item.topics || []), ...suggestedTopics]))
      updateItem({ topics: newTopics })
    } finally {
      setIsSuggestingTopics(false)
    }
  }

  const clearSolutionComments = () => {
    if (!item) return
    const cleaned = clearCommentsAndDocstrings(item.solution)
    updateItem({ solution: cleaned })
  }

  const clearTestComments = () => {
    if (!item) return
    const cleaned = clearCommentsAndDocstrings(item.unit_tests)
    updateItem({ unit_tests: cleaned })
  }

  if (loading || !item || allItems.length === 0) {
    return (
      <div className="container mx-auto p-2 max-w-screen-2xl">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading item...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-screen-2xl mx-auto h-screen grid grid-rows-[auto_auto_auto_1fr_auto] gap-0">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/${groupContext.group ? `?group=${encodeURIComponent(groupContext.group)}` : ''}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <p className="text-muted-foreground">
              Item {currentIndex + 1} of {allItems.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigateToItem('prev')} disabled={currentIndex === 0}>
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigateToItem('next')} disabled={currentIndex === allItems.length - 1}>
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2 px-1">
        <Select value={selectedVersionId || ''} onValueChange={(v) => setSelectedVersionId(v || null)}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select version" />
          </SelectTrigger>
          <SelectContent>
            {versions.map(v => (
              <SelectItem key={v.id} value={v.id}>
                {(v.label || v.id.slice(0, 8)) + (item.currentVersionId === v.id ? ' • HEAD' : '')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => selectedVersionId && loadVersion(selectedVersionId)} disabled={!selectedVersionId}>Load</Button>
        <Button variant="outline" size="sm" onClick={setHeadVersion} disabled={!selectedVersionId || item.currentVersionId === selectedVersionId}>Set Head</Button>
        <Input className="w-48" placeholder="New version label" value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} />
        <Button size="sm" onClick={createVersion}>Create Version</Button>
        {item.currentVersionId ? <Badge variant="secondary">HEAD: {versions.find(v => v.id === item.currentVersionId)?.label || (item.currentVersionId || '').slice(0,8)}</Badge> : null}
      </div>

      {groupContext.group && (
        <Alert className="p-1 text-blue-500 bg-blue-50 border-blue-200">
          <AlertDescription className="p-0">
            Viewing items in group: <strong>{groupContext.groupName}</strong>
          </AlertDescription>
        </Alert>
      )}

      {hasUnsavedChanges && (
        <Alert className="p-1 text-red-500">
          <AlertDescription className="p-0">
            You have unsaved changes. Don't forget to save your work!
          </AlertDescription>
        </Alert>
      )}

      <main className="grid grid-cols-2 grid-rows-2 overflow-hidden">
        <Card className="grid grid-rows-[auto_1fr] overflow-y-scroll">
          <CardContent className="space-y-4 p-1">
            <div>
              <Label htmlFor="prompt">Problem Prompt</Label>
              <Textarea id="prompt" placeholder="Enter the problem statement..." value={item.prompt || ''} onChange={(e) => updateItem({ prompt: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="inputs">Inputs</Label>
              <Textarea id="inputs" placeholder="Describe inputs or provide examples..." value={item.inputs || ''} onChange={(e) => updateItem({ inputs: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="outputs">Outputs</Label>
              <Textarea id="outputs" placeholder="Describe expected outputs or provide examples..." value={item.outputs || ''} onChange={(e) => updateItem({ outputs: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="code_file">Code File</Label>
              <Input id="code_file" value={item.code_file || ''} onChange={(e) => updateItem({ code_file: e.target.value })} placeholder="e.g., def solve(...)" />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Add any notes..." value={item.notes || ''} onChange={(e) => updateItem({ notes: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="difficulty">Difficulty</Label>
              <Select value={item.difficulty} onValueChange={(value: 'Easy' | 'Medium' | 'Hard') => updateItem({ difficulty: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Easy">Easy</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="Hard">Hard</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="time_complexity">Time Complexity</Label>
              <Textarea id="time_complexity" value={item.time_complexity} onChange={(e) => updateItem({ time_complexity: e.target.value })} placeholder="e.g., O(n log n)..." onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="space_complexity">Space Complexity</Label>
              <Textarea id="space_complexity" value={item.space_complexity} onChange={(e) => updateItem({ space_complexity: e.target.value })} placeholder="e.g., O(n)..." onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label>Topics</Label>
              <TopicsEditor topics={item.topics} newTopic={newTopic} setNewTopic={setNewTopic} onAddTopic={addTopic} onRemoveTopic={removeTopic} onSuggestTopics={suggestTopics} suggesting={isSuggestingTopics} suggestDisabled={!item.prompt || !item.solution} />
            </div>
          </CardContent>
        </Card>

        <TestExecutionPanel
          lastRunSuccessful={item.lastRunSuccessful}
          running={running}
          onRun={runTests}
          testResult={testResult}
          copyPayload={{
            prompt: item.prompt || '',
            inputs: item.inputs || '',
            outputs: item.outputs || '',
            solution: item.solution || '',
            unit_tests: item.unit_tests || '',
          }}
        />

        <CodeEditorPanel title="Solution Code" code={item.solution} onChange={code => updateItem({ solution: code })} onClear={clearSolutionComments} clearDisabled={!item.solution} placeholder="def solution(): ..." />

        <CodeEditorPanel title="Unit Tests" code={item.unit_tests} onChange={code => updateItem({ unit_tests: code })} onClear={clearTestComments} clearDisabled={!item.unit_tests} placeholder="def test_solution(): ..." />
      </main>

      <footer className="flex justify-between">
        <Button variant="destructive" onClick={handleDelete}><Trash2 className="w-4 h-4 mr-2" />Delete Item</Button>
        <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges}><Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Changes (Ctrl+S)'}</Button>
      </footer>
    </div>
  )
}
