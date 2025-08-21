'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, Save } from 'lucide-react'
import Link from 'next/link'
import TestExecutionPanel from '@/components/TestExecutionPanel'
import CodeEditorPanel from '@/components/CodeEditorPanel'
import TopicsEditor from '@/components/TopicsEditor'
import { clearCommentsAndDocstrings } from '@/components/utils'
import { useAutoResize } from '@/components/useAutoResize'
import { DatasetItem } from '@/components/types'
import { useAuth } from '@/components/auth-context'

type NewDatasetItem = Omit<DatasetItem, 'id' | 'createdAt' | 'updatedAt' | 'lastRunSuccessful'> & { lastRunSuccessful?: boolean }

interface TestResult {
  success: boolean
  output: string
  error?: string
  timeout?: boolean
}

export default function NewReview() {
  const router = useRouter()
  const { headers: authHeaders } = useAuth()
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [newTopic, setNewTopic] = useState('')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [initialVersionLabel, setInitialVersionLabel] = useState('v1')
  const [item, setItem] = useState<NewDatasetItem>({
    prompt: '',
    unit_tests: '',
    solution: '',
    time_complexity: '',
    space_complexity: '',
    topics: [],
    difficulty: 'Easy',
    notes: '',
    code_file: '',
    inputs: '',
    outputs: ''
  })
  const { handleAutoResize } = useAutoResize()

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/dataset', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (response.ok) {
        const newItem = await response.json()
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
        const vRes = await fetch(`/api/dataset/${newItem.id}/versions`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: snapshot, parentId: null, label: initialVersionLabel || 'v1' })
        })
        if (vRes.ok) {
          const created = await vRes.json()
          await fetch(`/api/dataset/${newItem.id}/head`, {
            method: 'PUT',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ versionId: created.id })
          })
        }
        try {
          const raw = sessionStorage.getItem('dataset:all')
          if (raw) {
            const j = JSON.parse(raw)
            if (Array.isArray(j?.data)) {
              const next = [...j.data, newItem]
              sessionStorage.setItem('dataset:all', JSON.stringify({ ts: Date.now(), data: next }))
            }
          }
        } catch {}
        router.push(`/review/${newItem.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const runTests = async () => {
    setRunning(true)
    setTestResult(null)
    try {
      const response = await fetch('/api/run-tests', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: item.solution, tests: item.unit_tests }),
      })
      const result = await response.json()
      setTestResult(result)
      setItem(prev => ({ ...prev, lastRunSuccessful: result.success }))
      setHasUnsavedChanges(true)
    } catch {
      setTestResult({ success: false, output: '', error: 'Failed to run tests' })
    } finally {
      setRunning(false)
    }
  }

  const updateItem = (updates: Partial<NewDatasetItem>) => {
    const newUpdates = { ...updates }
    if ('solution' in updates || 'unit_tests' in updates) {
      ;(newUpdates as any).lastRunSuccessful = false
    }
    setItem(prev => ({ ...prev, ...newUpdates }))
    setHasUnsavedChanges(true)
  }

  const addTopic = () => {
    if (newTopic.trim() && !item.topics.includes(newTopic.trim())) {
      updateItem({ topics: [...item.topics, newTopic.trim()] })
      setNewTopic('')
    }
  }

  const removeTopic = (topicToRemove: string) => {
    updateItem({ topics: item.topics.filter(topic => topic !== topicToRemove) })
  }

  const clearSolutionComments = () => {
    const cleaned = clearCommentsAndDocstrings(item.solution)
    updateItem({ solution: cleaned })
  }

  const clearTestComments = () => {
    const cleaned = clearCommentsAndDocstrings(item.unit_tests)
    updateItem({ unit_tests: cleaned })
  }

  return (
    <div className="max-w-screen-2xl mx-auto h-screen grid grid-rows-[auto_auto_1fr_auto] gap-0">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">Create New Dataset Item</h1>
          </div>
        </div>
      </header>

      {hasUnsavedChanges && (
        <Alert className="p-1 text-red-500">
          <AlertDescription className="p-0">
            You have unsaved changes. Don't forget to save your work!
          </AlertDescription>
        </Alert>
      )}

      <main className="grid grid-cols-2 grid-rows-2 overflow-hidden">
        <Card className="overflow-y-scroll">
          <CardContent className="space-y-4 p-1">
            <div>
              <Label htmlFor="prompt">Problem Prompt</Label>
              <Textarea id="prompt" placeholder="Enter the problem statement..." value={item.prompt} onChange={(e) => updateItem({ prompt: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="code_file">Code File</Label>
              <Input id="code_file" placeholder="e.g., def solve(...)" value={item.code_file} onChange={(e) => updateItem({ code_file: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" placeholder="Add any notes..." value={item.notes} onChange={(e) => updateItem({ notes: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="difficulty">Difficulty</Label>
              <Select value={item.difficulty} onValueChange={(value: 'Easy' | 'Medium' | 'Hard') => updateItem({ difficulty: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Easy">Easy</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="Hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="time_complexity">Time Complexity</Label>
              <Textarea id="time_complexity" placeholder="e.g., O(n log n)..." value={item.time_complexity} onChange={(e) => updateItem({ time_complexity: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label htmlFor="space_complexity">Space Complexity</Label>
              <Textarea id="space_complexity" placeholder="e.g., O(n)..." value={item.space_complexity} onChange={(e) => updateItem({ space_complexity: e.target.value })} onInput={handleAutoResize} className="resize-none overflow-y-hidden" />
            </div>
            <div>
              <Label>Topics</Label>
              <TopicsEditor topics={item.topics} newTopic={newTopic} setNewTopic={setNewTopic} onAddTopic={addTopic} onRemoveTopic={removeTopic} />
            </div>
            <div>
              <Label htmlFor="initial_version_label">Initial Version Label</Label>
              <Input id="initial_version_label" placeholder="v1" value={initialVersionLabel} onChange={(e) => setInitialVersionLabel(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <TestExecutionPanel
          lastRunSuccessful={item.lastRunSuccessful}
          running={running}
          onRun={runTests}
          runDisabled={!item.solution.trim() || !item.unit_tests.trim()}
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

      <footer className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Item'}
        </Button>
      </footer>
    </div>
  )
}
