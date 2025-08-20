'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Copy } from 'lucide-react'
import Link from 'next/link'
import { DatasetItemCard } from './dataset-item-card'

import { DatasetItem, SortKey } from './types'

interface DatasetItemsListProps {
  items: DatasetItem[]
  sortedItems: DatasetItem[]
  selectedIds: Set<string>
  sortConfig: { key: SortKey; direction: 'asc' | 'desc' }
  activeGroup: string | null
  uniqueGroups: string[]
  onSelectionChange: (id: string) => void
  onSelectAll: () => void
  onSort: (key: SortKey) => void
  onAssignGroup: (itemId: string, group: string | null) => void
}

export function DatasetItemsList({
  items,
  sortedItems,
  selectedIds,
  sortConfig,
  activeGroup,
  uniqueGroups,
  onSelectionChange,
  onSelectAll,
  onSort,
  onAssignGroup
}: DatasetItemsListProps) {
  

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Dataset Items ({selectedIds.size} selected)</CardTitle>
            <CardDescription>Click an item to edit. Use checkboxes for export. Assign groups on the right.</CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={onSelectAll} disabled={sortedItems.length === 0}>
              {selectedIds.size === sortedItems.length && sortedItems.length > 0 ? 'Deselect All' : 'Select All'}
            </Button>
            <Button variant="ghost" onClick={() => onSort('lastRunSuccessful')}>Sort by Run Status</Button>
            <Button variant="ghost" onClick={() => onSort('difficulty')}>Sort by Difficulty</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No dataset items found</p>
            <Link href="/review">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Create First Item
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            <datalist id="group-list">
              {uniqueGroups.map(groupName => (
                <option key={groupName} value={groupName} />
              ))}
            </datalist>
            {sortedItems.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto] gap-2 w-full">
                <div className="min-w-0">
                
                  <DatasetItemCard
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    onSelectionChange={onSelectionChange}
                    onAssignGroup={onAssignGroup}
                    activeGroup={activeGroup}
                    uniqueGroups={uniqueGroups}
                  />
                </div>
                
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
