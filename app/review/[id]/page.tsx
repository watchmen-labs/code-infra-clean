// app/review/[id]/page.tsx
"use client";

import { useEffect, useLayoutEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TestExecutionPanel from "@/components/TestExecutionPanel";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import { useAutoResize } from "@/components/useAutoResize";

import HeaderControls from "@/components/HeaderControls";
import ItemForm from "@/components/ItemForm";
import FooterActions from "@/components/FooterActions";
import HistoryModal from "@/components/HistoryModal";

import { useReviewItem } from "@/components/ReviewItemHooks";
import { DatasetItem } from "@/components/types";

export default function ReviewItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const {
    status,
    groupContext, setGroupContext,
    item, setItem,
    allItems,
    currentIndex,
    loading,
    saving,
    running,
    testResultRef,
    testResultSota,
    newTopic, setNewTopic,
    hasUnsavedChanges,
    isSuggestingTopics,
    versions,
    selectedVersionId, setSelectedVersionId,
    showHistory, setShowHistory,
    loadVersion,
    stampTask,
    handleSave,
    handleDelete,
    runTests,
    navigateToItem,
    updateItem,
    addTopic,
    removeTopic,
    suggestTopics,
    clearSolutionComments,
    clearSotaSolutionComments,
    clearTestComments,
    headStamped,
    headDisplay,
  } = useReviewItem(id, router);

  const { resizeTextarea, handleAutoResize } = useAutoResize();

  // resize textareas when switching versions/items
  useLayoutEffect(() => {
    if (!item) return;
    const ids = ["prompt", "inputs", "outputs", "notes", "time_complexity", "space_complexity", "sota_time_complexity", "sota_space_complexity"];
    ids.forEach(k => {
      const el = document.getElementById(k) as HTMLTextAreaElement | null;
      if (el) resizeTextarea(el);
    });
  }, [item?.id, selectedVersionId, resizeTextarea]);

  // early loading view
  if (loading || !item || allItems.length === 0) {
    return (
      <div className="container mx-auto p-2 max-w-screen-2xl">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading item...</div>
        </div>
      </div>
    );
  }

  const groupQuery = groupContext.group ? `?group=${encodeURIComponent(groupContext.group)}` : "";

  return (
    <div className="max-w-screen-2xl mx-auto h-screen grid grid-rows-[auto_auto_1fr_auto] gap-0">
      <HeaderControls
        groupQuery={groupQuery}
        currentIndex={currentIndex}
        totalItems={allItems.length}
        canPrev={currentIndex !== 0}
        canNext={currentIndex !== allItems.length - 1}
        onPrev={() => navigateToItem("prev")}
        onNext={() => navigateToItem("next")}
        isAuthenticated={status === "authenticated"}
        onStamp={stampTask}
        onShowHistory={() => setShowHistory(true)}
        headDisplay={headDisplay}
        headStamped={headStamped}
      />

      {groupContext.group && (
        <Alert className="p-1 text-blue-500 bg-blue-50 border-blue-200">
          <AlertDescription className="p-0">
            Viewing items in group: <strong>{groupContext.group}</strong>
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
        <ItemForm
          item={item as DatasetItem}
          selectedVersionId={selectedVersionId}
          newTopic={newTopic}
          setNewTopic={setNewTopic}
          isSuggestingTopics={isSuggestingTopics}
          updateItem={updateItem}
          addTopic={addTopic}
          removeTopic={removeTopic}
          suggestTopics={suggestTopics}
          onAutoResize={handleAutoResize}
        />

        <TestExecutionPanel
          lastRunSuccessful={!!item.lastRunSuccessful}
          sotaCorrect={item.sota_correct}
          running={running}
          onRun={runTests}
          testResultRef={testResultRef}
          testResultSota={testResultSota}
          copyPayload={{
            prompt: item.prompt ?? "",
            inputs: item.inputs ?? "",
            outputs: item.outputs ?? "",
            solution: item.solution ?? "",
            unit_tests: item.unit_tests ?? "",
            sota_solution: item.sota_solution ?? ""
          }}
        />

        <div className="grid grid-rows-2 overflow-hidden">
          <CodeEditorPanel
            title="SOTA Solution"
            code={item.sota_solution ?? ""}
            onChange={code => updateItem({ sota_solution: code })}
            onClear={clearSotaSolutionComments}
            clearDisabled={!(item.sota_solution ?? "")}
            placeholder="def solution(): ..."
          />
          <CodeEditorPanel
            title="Reference Solution"
            code={item.solution ?? ""}
            onChange={code => updateItem({ solution: code })}
            onClear={clearSolutionComments}
            clearDisabled={!(item.solution ?? "")}
            placeholder="def solution(): ..."
          />
        </div>

        <CodeEditorPanel
          title="Unit Tests"
          code={item.unit_tests ?? ""}
          onChange={code => updateItem({ unit_tests: code })}
          onClear={clearTestComments}
          clearDisabled={!(item.unit_tests ?? "")}
          placeholder="def test_solution(): ..."
        />
      </main>

      <FooterActions
        saving={saving}
        hasUnsavedChanges={hasUnsavedChanges}
        onDelete={handleDelete}
        onSave={handleSave}
      />

      <HistoryModal
        show={showHistory}
        onClose={() => setShowHistory(false)}
        versions={versions}
        selectedVersionId={selectedVersionId}
        onSelectVersion={setSelectedVersionId}
        loadVersion={loadVersion}
        item={item as DatasetItem}
      />
    </div>
  );
}
