'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'

import { DatasetItem } from './types'

interface GroupsSectionProps {
  items: DatasetItem[]
  activeGroup: string | null
  onGroupChange: (group: string | null) => void
}

export function GroupsSection({ items, activeGroup, onGroupChange }: GroupsSectionProps) {
  const isNumericToken = (t: string) => /^\d+$/.test(t)
  const compareTokens = (a: string, b: string) => {
    const an = isNumericToken(a)
    const bn = isNumericToken(b)
    if (an && bn) return Number(a) - Number(b)
    return a.localeCompare(b)
  }
  const naturalGroupCompare = (a: string, b: string) => {
    const at = a.split('_')
    const bt = b.split('_')
    const len = Math.max(at.length, bt.length)
    for (let i = 0; i < len; i++) {
      const av = at[i] ?? ''
      const bv = bt[i] ?? ''
      const c = compareTokens(av, bv)
      if (c !== 0) return c
    }
    return a.localeCompare(b)
  }

  const uniqueGroups = Array.from(new Set(items.map(item => item.group).filter((g): g is string => !!g))).sort(naturalGroupCompare)

  const groupStats = (() => {
    const stats: Array<{ name: string; count: number; isUngrouped: boolean }> = []
    const ungroupedCount = items.filter(item => !item.group || item.group.trim() === '').length
    if (ungroupedCount > 0) {
      stats.push({ name: 'Ungrouped', count: ungroupedCount, isUngrouped: true })
    }
    uniqueGroups.forEach(groupName => {
      const count = items.filter(item => item.group === groupName).length
      stats.push({ name: groupName, count, isUngrouped: false })
    })
    return stats
  })()

  const copyGroupAsJSONL = (group: string | null) => {
    let targetItems: DatasetItem[]
    if (group === null) {
      targetItems = items
    } else if (group === 'Ungrouped') {
      targetItems = items.filter(item => !item.group || item.group.trim() === '')
    } else {
      targetItems = items.filter(item => item.group === group)
    }
    const transformed = targetItems.map(item => ({
      id: item.id,
      language: item.language || 'python',
      prompt: item.prompt,
      inputs: item.inputs,
      outputs: item.outputs,
      code_file: item.code_file,
      reference_solution: item.solution,
      unit_tests: item.unit_tests,
      metadata: {
        difficulty: item.difficulty,
        topics: item.topics,
        time_complexity: item.time_complexity,
        space_complexity: item.space_complexity,
      }
    }))
    const jsonl = transformed.map(obj => JSON.stringify(obj)).join('\n')
    navigator.clipboard.writeText(jsonl)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Groups</CardTitle>
        <CardDescription>Assign groups to items below. Click a group name to filter the list.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-y-2">
          <div className="flex items-center gap-1">
            <Badge
              variant={activeGroup === null ? 'default' : 'secondary'}
              onClick={() => onGroupChange(null)}
              className={`cursor-pointer text-base py-1 px-3 ${activeGroup === null ? 'bg-blue-600 text-white hover:bg-blue-600' : ''}`}
            >
              All Problems ({items.length})
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => copyGroupAsJSONL(null)}
              aria-label="Copy All Problems as JSONL"
              title="Copy JSONL"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {groupStats.map(({ name, count, isUngrouped }) => (
            <div key={name} className="flex items-center gap-1 pl-3 ml-1 border-l">
              <Badge
                variant={activeGroup === name ? 'default' : 'secondary'}
                onClick={() => onGroupChange(isUngrouped ? 'Ungrouped' : name)}
                className={`cursor-pointer text-base py-1 px-3 ${activeGroup === name ? 'bg-blue-600 text-white hover:bg-blue-600' : ''}`}
              >
                {name} ({count})
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => copyGroupAsJSONL(isUngrouped ? 'Ungrouped' : name)}
                aria-label={`Copy ${name} as JSONL`}
                title="Copy JSONL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
