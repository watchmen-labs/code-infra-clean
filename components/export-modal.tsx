'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { X } from 'lucide-react'

import { DatasetItem } from './types'

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  items: DatasetItem[]
  selectedIds: Set<string>
  exportOptions: { format: 'json' | 'csv' | 'jsonl'; keys: Set<keyof DatasetItem> }
  onExportKeyToggle: (key: keyof DatasetItem) => void
  onExecuteExport: () => void
}

export function ExportModal({
  isOpen,
  onClose,
  items,
  selectedIds,
  exportOptions,
  onExportKeyToggle,
  onExecuteExport
}: ExportModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex justify-center items-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            Export Options
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardTitle>
          {/* <CardDescription>Select the fields you want to export. {selectedIds.size > 0 ? `${selectedIds.size} items selected.` : 'All items will be exported.'}</CardDescription> */}
        </CardHeader>
        {/* <CardContent className="max-h-80 overflow-y-auto grid grid-cols-2 gap-2 p-4">
          {(items.length > 0 ? Object.keys(items[0]) : []).map(key => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`key-${key}`}
                checked={exportOptions.keys.has(key as keyof DatasetItem)}
                onCheckedChange={() => onExportKeyToggle(key as keyof DatasetItem)}
              />
              <label htmlFor={`key-${key}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                {key}
              </label>
            </div>
          ))}
        </CardContent> */}
        <div className="flex justify-end p-4 border-t">
          <Button onClick={onExecuteExport}>Export to .{exportOptions.format.toUpperCase()}</Button>
        </div>
      </Card>
    </div>
  )
}
