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

interface DatasetItem {
  id: string
  prompt: string
  inputs: string
  outputs: string
  code_file: string
  unit_tests: string
  solution: string
  time_complexity: string
  space_complexity: string
  topics: string[]
  difficulty: 'Easy' | 'Medium' | 'Hard'
  notes: string
  lastRunSuccessful: boolean
  createdAt: string
  updatedAt: string
  group?: string | null
}

interface TestResult {
  success: boolean
  output: string
  error?: string
  timeout?: boolean
}

export default function ReviewItem() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  
  const [groupContext, setGroupContext] = useState<{
    group: string | null;
    groupName: string | null;
  }>({ group: null, groupName: null })

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

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const groupParam = urlParams.get('group')
    
    const initializePage = async () => {
      try {
        if (groupParam) {
          setGroupContext({ group: groupParam, groupName: groupParam })
        }
        
        const response = await fetch('/api/dataset')
        const items = await response.json()
        
        let filteredItems: DatasetItem[]
        if (groupParam === 'Ungrouped') {
          filteredItems = items.filter((item: DatasetItem) => !item.group || item.group.trim() === '')
        } else if (groupParam) {
          filteredItems = items.filter((item: DatasetItem) => item.group === groupParam)
        } else {
          filteredItems = items
        }
        
        const filteredItemIds = filteredItems.map((item: DatasetItem) => item.id)
        setAllItems(filteredItemIds)
        
        const currentIndex = filteredItemIds.indexOf(id)
        if (currentIndex !== -1) {
          setCurrentIndex(currentIndex)
          const itemResponse = await fetch(`/api/dataset/${id}`)
          if (itemResponse.ok) {
            const itemData = await itemResponse.json()
            setItem(itemData)
            setHasUnsavedChanges(false)
          } else {
            router.push('/')
          }
        }
      } catch (error) {
      } finally {
        setLoading(false)
      }
    }
    
    initializePage()
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

  const fetchItem = async (itemId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/dataset/${itemId}`)
      if (response.ok) {
        const data = await response.json()
        setItem(data)
        setHasUnsavedChanges(false)
      } else {
        router.push('/')
      }
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!item) return

    setSaving(true)
    try {
      const response = await fetch(`/api/dataset/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(item),
      })

      if (response.ok) {
        const updatedItem = await response.json()
        setItem(updatedItem)
        setHasUnsavedChanges(false)
      }
    } catch (error) {
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!item || !confirm('Are you sure you want to delete this item?')) return

    try {
      const response = await fetch(`/api/dataset/${item.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        router.push('/')
      }
    } catch (error) {
    }
  }

  const runTests = async () => {
    if (!item) return

    setRunning(true)
    setTestResult(null)

    try {
      const response = await fetch('/api/run-tests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          solution: item.solution,
          tests: item.unit_tests,
        }),
      })

      const result = await response.json()
      setTestResult(result)

      const updatedItem = { ...item, lastRunSuccessful: result.success }
      setItem(updatedItem)

      await fetch(`/api/dataset/${item.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedItem),
      })
    } catch (error) {
      setTestResult({
        success: false,
        output: '',
        error: 'Failed to run tests'
      })
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
    if (!item?.prompt || !item?.solution) return

    setIsSuggestingTopics(true)
    try {
      const response = await fetch('/api/suggest-topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: item.prompt,
          solution: item.solution,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch topic suggestions')
      }

      const data = await response.json()
      const suggestedTopics = data.topics || []

      const newTopics = Array.from(new Set([...item.topics, ...suggestedTopics]))
      updateItem({ topics: newTopics })
    } catch (error) {
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
    <div className="max-w-screen-2xl mx-auto h-screen grid grid-rows-[auto_auto_1fr_auto] gap-0">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToItem('prev')}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToItem('next')}
            disabled={currentIndex === allItems.length - 1}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </header>

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
              <Textarea
                id="prompt"
                placeholder="Enter the problem statement..."
                value={item.prompt || ''}
                onChange={(e) => updateItem({ prompt: e.target.value })}
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
            </div>
            <div>
              <Label htmlFor="inputs">Inputs</Label>
              <Textarea
                id="inputs"
                placeholder="Describe inputs or provide examples..."
                value={item.inputs || ''}
                onChange={(e) => updateItem({ inputs: e.target.value })}
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
            </div>
            <div>
              <Label htmlFor="outputs">Outputs</Label>
              <Textarea
                id="outputs"
                placeholder="Describe expected outputs or provide examples..."
                value={item.outputs || ''}
                onChange={(e) => updateItem({ outputs: e.target.value })}
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
            </div>
            <div>
              <Label htmlFor="code_file">Code File</Label>
              <Input
                id="code_file"
                value={item.code_file || ''}
                onChange={(e) => updateItem({ code_file: e.target.value })}
                placeholder="e.g., def solve(...)"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes..."
                value={item.notes || ''}
                onChange={(e) => updateItem({ notes: e.target.value })}
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
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
              <Textarea
                id="time_complexity"
                value={item.time_complexity}
                onChange={(e) => updateItem({ time_complexity: e.target.value })}
                placeholder="e.g., O(n log n)..."
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
            </div>
            <div>
              <Label htmlFor="space_complexity">Space Complexity</Label>
              <Textarea
                id="space_complexity"
                value={item.space_complexity}
                onChange={(e) => updateItem({ space_complexity: e.target.value })}
                placeholder="e.g., O(n)..."
                onInput={handleAutoResize}
                className="resize-none overflow-y-hidden"
              />
            </div>
            <div>
              <Label>Topics</Label>
              <TopicsEditor
                topics={item.topics}
                newTopic={newTopic}
                setNewTopic={setNewTopic}
                onAddTopic={addTopic}
                onRemoveTopic={removeTopic}
                onSuggestTopics={suggestTopics}
                suggesting={isSuggestingTopics}
                suggestDisabled={!item.prompt || !item.solution}
              />
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

        <CodeEditorPanel
          title="Solution Code"
          code={item.solution}
          onChange={code => updateItem({ solution: code })}
          onClear={clearSolutionComments}
          clearDisabled={!item.solution.trim()}
          placeholder="def solution(): ..."
        />

        <CodeEditorPanel
          title="Unit Tests"
          code={item.unit_tests}
          onChange={code => updateItem({ unit_tests: code })}
          onClear={clearTestComments}
          clearDisabled={!item.unit_tests.trim()}
          placeholder="def test_solution(): ..."
        />
      </main>

      <footer className="flex justify-between">
        <Button variant="destructive" onClick={handleDelete}><Trash2 className="w-4 h-4 mr-2" />Delete Item</Button>
        <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges}><Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save Changes (Ctrl+S)'}</Button>
      </footer>
    </div>
  )
}
