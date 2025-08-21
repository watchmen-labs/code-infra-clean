// components/ReviewItemHooks.ts
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { DatasetItem, TestResult, VersionNode } from "@/components/types";
import { readCache, writeCache, updateArrayItemInCacheById, formatStandardLabel, mergeStampIntoLabel, parseStandardLabel } from "@/components/utils";
import { clearCommentsAndDocstrings } from "@/components/utils";

const TTL_MS = 60_000;
const DS_KEY = "dataset:all";

export function useReviewItem(id: string, router: any) {
  const { user, status, headers: authHeaders } = useAuth();

  const [groupContext, setGroupContext] = useState<{ group: string | null; groupName: string | null; }>({ group: null, groupName: null });
  const [item, setItem] = useState<DatasetItem | null>(null);
  const [allItems, setAllItems] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
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
    const res = await fetch("/api/dataset", { cache: "no-store", headers: { ...(authHeaders || {}) } });
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
        time_complexity: d.time_complexity ?? "",
        space_complexity: d.space_complexity ?? "",
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
      headers: { ...(authHeaders || {}) }
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
          let fresh: DatasetItem | null = null;
          try {
            const itemRes = await fetch(`/api/dataset/${id}`, { cache: "no-store", headers: { ...(authHeaders || {}) } });
            if (itemRes.ok) {
              const itemData = await itemRes.json();
              fresh = itemData;
              setItem(itemData);
              updateDatasetCacheItem(itemData);
            }
          } catch {}
          const base = fresh || fromList || null;
          await fetchVersions(id, base?.currentVersionId || null, true);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router, authHeaders]);

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
      headers: { ...(authHeaders || {}) }
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
      headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
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
    if (!base || status !== "authenticated" || !user) return false;
    const me = identity();
    const info = parseStandardLabel(base.label);
    if (info.editor && info.editor === me) return true;
    if (!info.editor && base.authorId && (base.authorId === user.id)) return true;
    return false;
  };

  const setHeadPointer = async (versionId: string) => {
    if (!item) return;
    const headRes = await fetch(`/api/dataset/${item.id}/head`, {
      method: "PUT",
      headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
      body: JSON.stringify({ versionId })
    });
    if (headRes.ok) {
      const updated = await headRes.json();
      setItem(updated);
      updateDatasetCacheItem(updated);
    }
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
      time_complexity: item.time_complexity || "",
      space_complexity: item.space_complexity || "",
      topics: item.topics || [],
      difficulty: item.difficulty || "Easy",
      notes: item.notes || ""
    };
    const baseId = parentId || selectedVersionId || item.currentVersionId || null;
    const base = versions.find(v => v.id === baseId) || null;
    const baseInfo = parseStandardLabel(base?.label);
    const proposedInfo = parseStandardLabel(label || "");
    const editor = baseInfo.editor || identity(); // default editor = me if missing
    const mergedStamps = Array.from(new Set([...(baseInfo.stamps || []), ...(proposedInfo.stamps || [])]));
    const nextLabel = formatStandardLabel(editor, mergedStamps);
    await safePutItem(snapshot);
    const ok = await updateVersion(baseId || "", snapshot, nextLabel);
    if (ok) {
    await setHeadPointer(baseId|| "");
    return { id: baseId, parentId: base?.parentId };
    }
    // Fallback: if PATCH failed (e.g., permissions), create a new version
    // so the user still gets a saved version.
    
    const res = await fetch(`/api/dataset/${item.id}/versions`, {
      method: "POST",
      headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
      body: JSON.stringify({
        data: snapshot,
        parentId: baseId || null,
        label: label || formatStandardLabel(identity(), [])
      })
    });
    if (!res.ok) return null;
    const created = await res.json();
    setVersions(prev => [
      ...prev,
      {
        id: created.id,
        itemId: item.id,
        parentId: created.parentId,
        label: label || formatStandardLabel(identity(), []),
        data: snapshot,
        authorId: created.authorId,
        createdAt: created.createdAt
      }
    ]);
    setSelectedVersionId(created.id);
    setEditedFromVersionId(created.id);
    await setHeadPointer(created.id);
    return created;
  };

  const updateVersionLabel = async (versionId: string, label: string) => {
    if (!item) return;
    const res = await fetch(`/api/dataset/${item.id}/versions/${versionId}`, {
      method: "PATCH",
      headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
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

  const stampTask = async () => {
    if (status !== "authenticated" || !user) return;
    const me = identity();
    if (!hasUnsavedChanges && selectedVersionId) {
      const current = versions.find(v => v.id === selectedVersionId);
       const info = parseStandardLabel(current?.label);
      // If no editor set yet, default editor becomes me
      const editor = info.editor || me;
      const mergedStamps = Array.from(new Set([...(info.stamps || []), me]));
      const nextLabel = formatStandardLabel(editor, mergedStamps);
      const ok = await updateVersionLabel(selectedVersionId, nextLabel);
      if (!ok) {
        // Fallback: create a new stamped version from current
        await createVersionFrom(selectedVersionId, nextLabel);
      }
      return;
    }
    // If there are unsaved changes, first create a version capturing them and stamp it.
    await createVersionFrom(
      editedFromVersionId || selectedVersionId || null,
      formatStandardLabel(me, [me])
    );
  };

  const safePutItem = async (body: Partial<DatasetItem>) => {
    try {
      const res = await fetch(`/api/dataset/${item?.id}`, {
        method: "PUT",
        headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("PUT failed");
      const updated = await res.json();
      setItem(updated);
      updateDatasetCacheItem(updated);
      return true;
    } catch {
      return false;
    }
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
        time_complexity: item.time_complexity || "",
        space_complexity: item.space_complexity || "",
        topics: item.topics || [],
        difficulty: item.difficulty || "Easy",
        notes: item.notes || "",
        lastRunSuccessful: item.lastRunSuccessful || false
      };
      await safePutItem(payload);
      const me = identity();
      await createVersionFrom(editedFromVersionId || selectedVersionId || null, formatStandardLabel(me, []));
      setHasUnsavedChanges(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item || !confirm("Are you sure you want to delete this item?")) return;
    try {
      const response = await fetch(`/api/dataset/${item.id}`, { method: "DELETE", headers: { ...(authHeaders || {}) } });
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
    setTestResult(null);
    try {
      const response = await fetch("/api/run-tests", {
        method: "POST",
        headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
        body: JSON.stringify({ solution: item.solution, tests: item.unit_tests })
      });
      const result = await response.json();
      setTestResult(result);
      const updatedItem = { ...item, lastRunSuccessful: result.success };
      setItem(updatedItem);
      setHasUnsavedChanges(true);
    } catch {
      setTestResult({ success: false, output: "", error: "Failed to run tests" });
    } finally {
      setRunning(false);
    }
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
    const newUpdates: Partial<DatasetItem & { lastRunSuccessful: boolean }> = { ...updates };
    if ("solution" in updates || "unit_tests" in updates) {
      newUpdates.lastRunSuccessful = false;
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
        headers: { ...(authHeaders || {}), "Content-Type": "application/json" },
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
    testResult,
    newTopic, setNewTopic,
    hasUnsavedChanges,
    isSuggestingTopics,
    versions,
    selectedVersionId, setSelectedVersionId,
    showHistory, setShowHistory,
    editedFromVersionId, setEditedFromVersionId,

    // actions
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
    clearTestComments,

    // header derived
    headStamped,
    headDisplay,
  };
}
