// components/ReviewItemHooks.ts
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { DatasetItem, TestResult, VersionNode } from "@/components/types";
import { readCache, writeCache, updateArrayItemInCacheById, formatStandardLabel, mergeStampIntoLabel, parseStandardLabel } from "@/components/utils";
import { clearCommentsAndDocstrings } from "@/components/utils";
import { runAutograder } from "./testharness";

const TTL_MS = 60_000;
const DS_KEY = "dataset:all";

export function useReviewItem(id: string, router: any) {
  const { user, status, headers: getAuthHeaders } = useAuth();

  const [groupContext, setGroupContext] = useState<{ group: string | null; groupName: string | null; }>({ group: null, groupName: null });
  const [item, setItem] = useState<DatasetItem | null>(null);
  const [allItems, setAllItems] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testResultRef, setTestResultRef] = useState<TestResult | null>(null);
  const [testResultSota, setTestResultSota] = useState<TestResult | null>(null);
  const [newTopic, setNewTopic] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSuggestingTopics, setIsSuggestingTopics] = useState(false);
  const [versions, setVersions] = useState<VersionNode[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editedFromVersionId, setEditedFromVersionId] = useState<string | null>(null);

  const identity = () => (user?.email || user?.id || "").trim();

  const updateDatasetCacheItem = (updated: DatasetItem) => {
    updateArrayItemInCacheById(DS_KEY, updated);
  };

  const loadDatasetList = async (): Promise<DatasetItem[]> => {
    const cached = readCache(DS_KEY, TTL_MS);
    if (cached) return cached as DatasetItem[];
    const res = await fetch("/api/dataset", { cache: "no-store", headers: { ...(getAuthHeaders() || {}) } });
    const data = await res.json();
    if (Array.isArray(data)) writeCache(DS_KEY, data);
    return data;
  };

  const applyVersionData = (d: Partial<DatasetItem>, markDirty: boolean) => {
    setItem(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        prompt: d.prompt ?? "",
        inputs: d.inputs ?? "",
        outputs: d.outputs ?? "",
        code_file: d.code_file ?? "",
        unit_tests: d.unit_tests ?? "",
        solution: d.solution ?? "",
        sota_solution: d.sota_solution ?? "",
        time_complexity: d.time_complexity ?? "",
        space_complexity: d.space_complexity ?? "",
        sota_time_complexity: d.sota_time_complexity ?? "",
        sota_space_complexity: d.sota_space_complexity ?? "",
        sota_correct: d.sota_correct ?? false,
        topics: Array.isArray(d.topics) ? (d.topics as string[]) : [],
        difficulty: (d.difficulty as any) || prev.difficulty,
        notes: d.notes ?? prev.notes ?? ""
      };
    });
    if (markDirty) setHasUnsavedChanges(true);
  };

  const fetchVersions = async (itemId: string, headId: string | null, preloadIntoEditor: boolean) => {
    const res = await fetch(`/api/dataset/${itemId}/versions`, {
      cache: "no-store",
      headers: { ...(getAuthHeaders() || {}) }
    });
    if (!res.ok) return;
    const data = await res.json();
    const flat = (data.flat || []) as VersionNode[];
    setVersions(flat);
    const head = headId || (flat.length ? flat[flat.length - 1].id : null);
    setSelectedVersionId(head || null);
    setEditedFromVersionId(head || null);
    if (preloadIntoEditor && head) {
      const headNode = flat.find(v => v.id === head);
      if (headNode && headNode.data) applyVersionData(headNode.data, false);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const groupParam = urlParams.get("group");
    const init = async () => {
      try {
        if (groupParam) setGroupContext({ group: groupParam, groupName: groupParam });
        const list = await loadDatasetList();
        let filtered: DatasetItem[] = list;
        if (groupParam === "Ungrouped") {
          filtered = list.filter((x: DatasetItem) => !x.group || x.group.trim() === "");
        } else if (groupParam) {
          filtered = list.filter((x: DatasetItem) => x.group === groupParam);
        }
        const ids = filtered.map(x => x.id);
        setAllItems(ids);
        const idx = ids.indexOf(id);
        if (idx !== -1) {
          setCurrentIndex(idx);
          const fromList = filtered.find(x => x.id === id) as DatasetItem | undefined;
          if (fromList) setItem(fromList);
          // Avoid a redundant GET for the same item; use the row from the list.
          await fetchVersions(id, (fromList && fromList.currentVersionId) || null, true);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (hasUnsavedChanges && !saving) {
          handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, hasUnsavedChanges, saving]);

  const loadVersion = async (versionId: string, markDirty: boolean = false) => {
    if (!versionId) return;
    const inLocal = versions.find(v => v.id === versionId);
    if (inLocal && inLocal.data) {
      applyVersionData(inLocal.data, markDirty);
      setSelectedVersionId(versionId);
      setEditedFromVersionId(versionId);
      setHasUnsavedChanges(false);
      return;
    }
    const res = await fetch(`/api/dataset/${id}/versions/${versionId}`, {
      cache: "no-store",
      headers: { ...(getAuthHeaders() || {}) }
    });
    if (!res.ok) return;
    const v = await res.json();
    const d = (v.data || {}) as Partial<DatasetItem>;
    applyVersionData(d, markDirty);
    setSelectedVersionId(versionId);
    setEditedFromVersionId(versionId);
    setHasUnsavedChanges(false);
  };

  const updateVersion = async (versionId: string, data: Partial<DatasetItem>, label?: string) => {
    if (!item) return null;
    const res = await fetch(`/api/dataset/${item.id}/versions/${versionId}`, {
      method: "PATCH",
      headers: { ...(getAuthHeaders() || {}), "Content-Type": "application/json" },
      body: JSON.stringify({ data, label })
    });
    if (!res.ok) {
      // Ensure failure here doesn't swallow the overall save:
      // caller will fallback to creating a new version.
      return null;
    }
    const updated = await res.json().catch(() => null);
    setVersions(prev => prev.map(v => v.id === versionId ? { ...v, data, label: label ?? v.label } : v));
    setSelectedVersionId(versionId);
    setEditedFromVersionId(versionId);
    return updated || true;
  };

  const shouldCompressToBase = (base: VersionNode | undefined | null) => {
    // Only allow "in-place" updates when:
    // 1) we're authenticated
    // 2) base exists and is a leaf (no other edits branched from it)
    // 3) the same editor is making a back-to-back edit (no credit stealing)
    if (!item || !base || status !== "authenticated" || !user) return false;
    // If any version uses this node as its parent, it's not safe to compress.
    const hasChildren = versions.some(v => v.parentId === base.id);
    if (hasChildren) return false;

    const me = identity();
    const info = parseStandardLabel(base.label);
    const sameEditor =
        (info.editor && info.editor === me) ||
        (!info.editor && base.authorId && base.authorId === user.id);

    return !!sameEditor;
  };
  // Single-call atomic save helper: creates or updates a version, promotes to head, mirrors dataset
  const atomicSave = async (snapshot: Partial<DatasetItem>, baseId: string | null, label: string) => {
    if (!item) return null;
    const base = versions.find(v => v.id === (baseId || ""));
    const compressIntoVersionId = base && shouldCompressToBase(base) ? base.id : null;

    const res = await fetch(`/api/dataset/${item.id}/save`, {
      method: "POST",
      headers: { ...(getAuthHeaders() || {}), "Content-Type": "application/json" },
      body: JSON.stringify({
        data: snapshot,
        label,
        parentId: baseId,
        compressIntoVersionId: compressIntoVersionId || undefined
      })
    });
    if (!res.ok) return null;
    const payload = await res.json();

    // Mirror dataset row (already in response) to local state/cache
    if (payload.dataset) {
      setItem(payload.dataset);
      updateDatasetCacheItem(payload.dataset);
    }

    // Update local versions so we don't need a re-fetch
    if (payload.inserted && payload.version) {
      setVersions(prev => [
        ...prev,
        {
          id: payload.version.id,
          itemId: item.id,
          parentId: payload.version.parentId,
          data: snapshot,
          label,
          authorId: payload.version.authorId,
          createdAt: payload.version.createdAt
        }
      ]);
      setSelectedVersionId(payload.version.id);
      setEditedFromVersionId(payload.version.id);
    } else if (compressIntoVersionId) {
      setVersions(prev => prev.map(v => v.id === compressIntoVersionId ? { ...v, data: snapshot, label } : v));
      setSelectedVersionId(compressIntoVersionId);
      setEditedFromVersionId(compressIntoVersionId);
    }
    setHasUnsavedChanges(false);
    return payload;
  };

  const createVersionFrom = async (parentId: string | null, label?: string) => {
    if (!item) return null;
    const snapshot = {
      prompt: item.prompt || "",
      inputs: item.inputs || "",
      outputs: item.outputs || "",
      code_file: item.code_file || "",
      unit_tests: item.unit_tests || "",
      solution: item.solution || "",
      sota_solution: item.sota_solution || "",
      time_complexity: item.time_complexity || "",
      space_complexity: item.space_complexity || "",
      sota_time_complexity: item.sota_time_complexity || "",
      sota_space_complexity: item.sota_space_complexity || "",
      sota_correct: item.sota_correct || false,
      lastRunSuccessful: item.lastRunSuccessful || false,
      topics: item.topics || [],
      difficulty: item.difficulty || "Easy",
      notes: item.notes || ""
    };
    const baseId = parentId || selectedVersionId || item.currentVersionId || null;
    const base = versions.find(v => v.id === baseId) || null;
    const baseInfo = parseStandardLabel(base?.label);
    const proposedInfo = parseStandardLabel(label || "");

    // Prefer the explicitly provided editor (e.g., when saving or stamping),
    // then fall back to the base editor, then finally me.
    const editor = proposedInfo.editor || baseInfo.editor || identity();

    // Merge stamps (set makes it idempotent). We do NOT force the previous
    // editor into stamps unless they had already stamped.
    const mergedStamps = Array.from(
    new Set([...(baseInfo.stamps || []), ...(proposedInfo.stamps || [])])
    );

    const nextLabel = formatStandardLabel(editor, mergedStamps);

    // Single atomic call handles (a) update existing version OR (b) create new version,
    // (c) promote to head, and (d) mirror into dataset.
    const payload = await atomicSave(snapshot, baseId || null, nextLabel);
    return payload;
  };

  const updateVersionLabel = async (versionId: string, label: string) => {
    if (!item) return;
    const res = await fetch(`/api/dataset/${item.id}/versions/${versionId}`, {
      method: "PATCH",
      headers: { ...(getAuthHeaders() || {}), "Content-Type": "application/json" },
      body: JSON.stringify({ label })
    });
    if (res.ok) {
      setVersions(prev =>
        prev.map(v => (v.id === versionId ? { ...v, label } : v))
      );
      return true;
    }
    return false;
  };

  const handleSave = async () => {
    if (!item || saving) return;
    setSaving(true);
    try {
      const payload: Partial<DatasetItem> = {
        prompt: item.prompt || "",
        inputs: item.inputs || "",
        outputs: item.outputs || "",
      code_file: item.code_file || "",
      unit_tests: item.unit_tests || "",
      solution: item.solution || "",
      sota_solution: item.sota_solution || "",
      time_complexity: item.time_complexity || "",
      space_complexity: item.space_complexity || "",
      sota_time_complexity: item.sota_time_complexity || "",
      sota_space_complexity: item.sota_space_complexity || "",
      sota_correct: item.sota_correct || false,
      topics: item.topics || [],
      difficulty: item.difficulty || "Easy",
      notes: item.notes || "",
      lastRunSuccessful: item.lastRunSuccessful || false
    };
      const me = identity();
      await atomicSave(
        payload,
        editedFromVersionId || selectedVersionId || null,
        formatStandardLabel(me, [])
      );
      setHasUnsavedChanges(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item || !confirm("Are you sure you want to delete this item?")) return;
    try {
      const response = await fetch(`/api/dataset/${item.id}`, { method: "DELETE", headers: { ...(getAuthHeaders() || {}) } });
      if (response.ok) {
        const cached = readCache(DS_KEY, TTL_MS);
        if (cached && Array.isArray(cached)) {
          writeCache(DS_KEY, (cached as any[]).filter((x: any) => x.id !== item.id));
        }
        router.push("/");
      }
    } catch {}
  };

  const runTests = async () => {
    if (!item) return;
    setRunning(true);
    setTestResultRef(null);
    setTestResultSota(null);
    let sotaRes: TestResult | null = null;
    if (item.sota_solution) {
      sotaRes = await runAutograder({ solution: item.sota_solution, tests: item.unit_tests }) as TestResult;
      setTestResultSota(sotaRes);
    }
    const refRes = await runAutograder({ solution: item.solution, tests: item.unit_tests }) as TestResult;
    setTestResultRef(refRes);
    const updatedItem = { ...item, lastRunSuccessful: refRes.success, sota_correct: sotaRes ? sotaRes.success : item.sota_correct };
    setItem(updatedItem as DatasetItem);
    setHasUnsavedChanges(true);
    setRunning(false);
    return { ref: refRes, sota: sotaRes };

    // try {
    //   const response = await fetch("/api/run-tests", {
    //     method: "POST",
    //     headers: { ...(getAuthHeaders() || {}), "Content-Type": "application/json" },
    //     body: JSON.stringify({ solution: item.solution, tests: item.unit_tests })
    //   });
    //   const result = await response.json();
    //   setTestResult(result);
    //   const updatedItem = { ...item, lastRunSuccessful: result.success };
    //   setItem(updatedItem);
    //   setHasUnsavedChanges(true);
    // } catch {
    //   setTestResult({ success: false, output: "", error: "Failed to run tests" });
    // } finally {
    //   setRunning(false);
    // }
  };

  const navigateToItem = (direction: "prev" | "next") => {
    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < allItems.length) {
      const groupQuery = groupContext.group ? `?group=${encodeURIComponent(groupContext.group)}` : "";
      router.push(`/review/${allItems[newIndex]}${groupQuery}`);
    }
  };

  const updateItem = (updates: Partial<DatasetItem>) => {
    if (!item) return;
    const newUpdates: Partial<DatasetItem & { lastRunSuccessful: boolean; sota_correct: boolean }> = { ...updates };
    if ("solution" in updates || "unit_tests" in updates) {
      newUpdates.lastRunSuccessful = false;
    }
    if ("sota_solution" in updates || "unit_tests" in updates) {
      newUpdates.sota_correct = false;
    }
    setItem(prev => (prev ? { ...prev, ...newUpdates } : null));
    setHasUnsavedChanges(true);
  };

  const addTopic = () => {
    if (newTopic.trim() && item && !(item.topics || []).includes(newTopic.trim())) {
      updateItem({ topics: [...(item.topics || []), newTopic.trim()] });
      setNewTopic("");
    }
  };

  const removeTopic = (topicToRemove: string) => {
    if (!item) return;
    updateItem({ topics: (item.topics || []).filter(topic => topic !== topicToRemove) });
  };

  const suggestTopics = async () => {
    if (!item?.prompt || !item?.solution || isSuggestingTopics) return;
    setIsSuggestingTopics(true);
    try {
      const response = await fetch("/api/suggest-topics", {
        method: "POST",
        headers: { ...(getAuthHeaders() || {}), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: item.prompt, solution: item.solution })
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      const suggestedTopics = data.topics || [];
      const newTopics = Array.from(new Set([...(item.topics || []), ...suggestedTopics]));
      updateItem({ topics: newTopics });
    } finally {
      setIsSuggestingTopics(false);
    }
  };

  const clearSolutionComments = () => {
    if (!item) return;
    const cleaned = clearCommentsAndDocstrings(item.solution ?? "");
    updateItem({ solution: cleaned });
  };

  const clearSotaSolutionComments = () => {
    if (!item) return;
    const cleaned = clearCommentsAndDocstrings(item.sota_solution ?? "");
    updateItem({ sota_solution: cleaned });
  };

  const clearTestComments = () => {
    if (!item) return;
    const cleaned = clearCommentsAndDocstrings(item.unit_tests ?? "");
    updateItem({ unit_tests: cleaned });
  };

  // derived values for header
  const headNode = versions.find(v => v.id === item?.currentVersionId) || null;
  const headInfo = headNode ? parseStandardLabel(headNode.label) : { editor: "", stamps: [] as string[] };
  const headStamped = !!headInfo.stamps.length;
  const headDisplay = item?.currentVersionId
    ? (headNode?.label ? headNode.label : (item.currentVersionId || "").slice(0, 8))
    : null;

  return {
    // state
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
    editedFromVersionId, setEditedFromVersionId,

    // actions
    loadVersion,
    stampTask: async () => {
        if (status !== "authenticated" || !user) return;
        const me = identity();

        // If nothing to save, just stamp the selected node in place.
        if (!hasUnsavedChanges && selectedVersionId) {
            const current = versions.find(v => v.id === selectedVersionId);
            const info = parseStandardLabel(current?.label);
            const editor = info.editor || me; // don't change editor if present
            const mergedStamps = Array.from(new Set([...(info.stamps || []), me]));
            const nextLabel = formatStandardLabel(editor, mergedStamps);
            const ok = await updateVersionLabel(selectedVersionId, nextLabel);
            if (!ok) {
            // Fallback: create a stamped version from current
            await createVersionFrom(selectedVersionId, nextLabel);
            }
            return;
        }

        // Unsaved changes present:
        // 1) Save a version with *you* as the editor (no stamps yet)
        if (!item) return;
        const snapshot: Partial<DatasetItem> = {
            prompt: item.prompt || "",
            inputs: item.inputs || "",
            outputs: item.outputs || "",
            code_file: item.code_file || "",
            unit_tests: item.unit_tests || "",
            solution: item.solution || "",
            sota_solution: item.sota_solution || "",
            time_complexity: item.time_complexity || "",
            space_complexity: item.space_complexity || "",
            sota_time_complexity: item.sota_time_complexity || "",
            sota_space_complexity: item.sota_space_complexity || "",
            sota_correct: item.sota_correct || false,
            lastRunSuccessful: item.lastRunSuccessful || false,
            topics: item.topics || [],
            difficulty: item.difficulty || "Easy",
            notes: item.notes || ""
        };
        const baseId = editedFromVersionId || selectedVersionId || null;

        // Save first, with editor=me, stamps=[]
        const savePayload = await atomicSave(
            snapshot,
            baseId,
            formatStandardLabel(me, [])
        );

        // 2) Now stamp the *new* head (or compressed head) by adding me to stamps
        const newHeadId = (savePayload && savePayload.versionId) || item.currentVersionId || selectedVersionId;
        if (newHeadId) {
            const current = versions.find(v => v.id === newHeadId);
            const info = parseStandardLabel(current?.label);
            const editor = info.editor || me; // should already be me after save
            const mergedStamps = Array.from(new Set([...(info.stamps || []), me]));
            const nextLabel = formatStandardLabel(editor, mergedStamps);
            await updateVersionLabel(newHeadId, nextLabel);
        }
        },
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

    // header derived
    headStamped,
    headDisplay,
  };
}
