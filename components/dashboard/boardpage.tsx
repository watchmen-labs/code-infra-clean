// components/dashboard/DashboardPage.tsx
'use client'

import { AnalyticsCards } from '@/components/analytics-cards'
import { DashboardHeader } from '@/components/dashboard-header'
import { DatasetItemsList } from '@/components/dataset-items-list'
import { ExportModal } from '@/components/export-modal'
import { GroupsSection } from '@/components/groups-section'
import { LoadingState } from '@/components/loading-state'
import ImportControls from './ImportControls'
import { useDatasetDashboard } from './useDatasetDashboard'

export default function DashboardPage() {
  const {
    // data
    items, analytics, loading,
    selectedIds, sortConfig, activeGroup, uniqueGroups, sortedItems,

    stampPaths,

    // state setters
    setSelectedIds, setSortConfig, setActiveGroup,

    // actions
    handleSort, handleSelection, handleSelectAll, handleAssignGroup,
    isExportModalOpen, setIsExportModalOpen, exportOptions, onExportKeyToggle, openExportDialog, executeExportLocal,

    // import UI
    importBusy, importErrors, importProgress,
    triggerImport, fileInputRef, fileInputKey, handleFileSelected
  } = useDatasetDashboard()

  if (loading) return <LoadingState />

  const handleSelectAllClick = () => handleSelectAll(sortedItems)

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Export modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        items={items}
        selectedIds={selectedIds}
        exportOptions={exportOptions}
        onExportKeyToggle={onExportKeyToggle}
        onExecuteExport={executeExportLocal}
      />

      <DashboardHeader onOpenExportDialog={openExportDialog} />

      <ImportControls
        importBusy={importBusy}
        importErrors={importErrors}
        importProgress={importProgress}
        triggerImport={triggerImport}
        fileInputRef={fileInputRef}
        fileInputKey={fileInputKey}
        handleFileSelected={handleFileSelected}
      />

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
        onSelectAll={handleSelectAllClick}
        onSort={handleSort}
        onAssignGroup={handleAssignGroup}
        stampPaths={stampPaths}
      />
    </div>
  )
}
