'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FileText, GitBranch } from 'lucide-react' // optional: icon for path
import Link from 'next/link'
import { Plus, Copy } from 'lucide-react'
import { DatasetItem } from './types'

interface DatasetItemCardProps {
  item: DatasetItem
  isSelected: boolean
  onSelectionChange: (id: string) => void
  onAssignGroup: (itemId: string, group: string | null) => void
  activeGroup: string | null
  uniqueGroups: string[]
  // NEW
  stampPath?: string
}

export function DatasetItemCard({
  item,
  isSelected,
  onSelectionChange,
  onAssignGroup,
  activeGroup,
  uniqueGroups,
  stampPath
}: DatasetItemCardProps) {
  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'Easy': return 'bg-green-100 text-green-800'
      case 'Medium': return 'bg-yellow-100 text-yellow-800'
      case 'Hard': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }
  const copyItemAsJSON = (item: DatasetItem) => {
    const obj = {
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
    }
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
  }
  const pathDisplay = (stampPath && stampPath.trim()) ? stampPath : 'none'

  return (
    <div className="flex items-center gap-3">
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => onSelectionChange(item.id)}
        aria-label={`Select item ${item.prompt}`}
      />
      
      <Link href={`/review/${item.id}${activeGroup ? `?group=${encodeURIComponent(activeGroup)}` : ''}`} className="flex-1 min-w-0">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate" title={item.prompt}>
                  {item.prompt}
                </h3>

                {item.notes && item.notes.trim() && (
                  <p className="text-sm text-muted-foreground mt-1 truncate text-blue-600" title={item.notes}>
                    {item.notes}
                  </p>
                )}

                {/* NEW: minimalist directed stamps path */}
                <p className="text-xs text-muted-foreground mt-1 truncate" title={pathDisplay}>
                  {/* optional icon */}
                  {/* <GitBranch className="inline-block w-3 h-3 mr-1" /> */}
                  {pathDisplay}
                </p>

                <div className="flex flex-wrap gap-1 mt-2">
                  {item.topics.map((topic) => (
                    <Badge key={topic} variant="secondary" className="text-xs">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge className={getDifficultyColor(item.difficulty)}>
                  {item.difficulty}
                </Badge>
                {item.lastRunSuccessful && (
                  <Badge variant="outline" className="text-green-600 border-green-600" title="Tests Pass">
                    ✓
                  </Badge>
                )}
                {item.notes && item.notes.trim() && (
                  <Badge variant="outline" className="text-blue-600 border-blue-600" title="Has Notes">
                    <FileText className="w-3 h-3" />
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      <div className="flex items-end">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => copyItemAsJSON(item)}
          aria-label={`Copy ${item.id} JSON`}
          title="Copy JSON"
        >
          <Copy className="w-4 h-4" />
        </Button>
      </div>

      <div className="w-40">
        <Input
          placeholder="Assign group..."
          defaultValue={item.group || ''}
          onClick={(e) => e.preventDefault()}
          onBlur={(e) => onAssignGroup(item.id, e.target.value.trim() || null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          list="group-list"
          className="w-full text-sm"
        />
      </div>
    </div>
  )
}
