'use client'

import { useState, useEffect, useMemo } from 'react'
import { DatasetItem, Analytics, SortKey } from '@/components/types'
import { calculateAnalytics, executeExport } from '@/components/utils'
import { ExportModal } from '@/components/export-modal'
import { AnalyticsCards } from '@/components/analytics-cards'
import { GroupsSection } from '@/components/groups-section'
import { DatasetItemsList } from '@/components/dataset-items-list'
import { DashboardHeader } from '@/components/dashboard-header'
import { LoadingState } from '@/components/loading-state'



export default function Dashboard() {
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

  useEffect(() => {
    fetchItems()
    
    // Check if there's a group parameter in the URL
    const urlParams = new URLSearchParams(window.location.search)
    const groupParam = urlParams.get('group')
    if (groupParam) {
      setActiveGroup(groupParam)
    }
  }, [])

  // Clear selection when active group changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [activeGroup])

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/dataset')
      const data = await response.json()
      setItems(data)
      calculateAnalyticsLocal(data)
    } catch (error) {
      console.error('Error fetching items:', error)
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

    try {
      await fetch(`/api/dataset/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItem),
      })
    } catch (error) {
      console.error('Error assigning group:', error)
      setItems(prevItems =>
        prevItems.map(item =>
          item.id === itemId ? originalItem : item
        )
      );
    }
  }

  const calculateAnalyticsLocal = (data: DatasetItem[]) => {
    const analyticsResult = calculateAnalytics(data)
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