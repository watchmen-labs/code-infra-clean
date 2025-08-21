// components/HistoryModal.tsx
"use client";

import { Button } from "@/components/ui/button";
import { VersionNode, DatasetItem } from "@/components/types";
import { formatStandardLabel, parseStandardLabel } from "@/components/utils";

interface Props {
  show: boolean;
  onClose: () => void;
  versions: VersionNode[];
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  loadVersion: (versionId: string, markDirty?: boolean) => Promise<void>;
  item: DatasetItem;
}

export default function HistoryModal({
  show, onClose, versions, selectedVersionId, onSelectVersion, loadVersion, item
}: Props) {
  if (!show) return null;

  const childrenOf = (pid: string | null) => versions.filter(n => n.parentId === pid);

  const ChainRow = ({ chain }: { chain: VersionNode[] }) => {
    const selectedInChain = chain.some(n => n.id === selectedVersionId);
    const headInChain = chain.some(n => n.id === item?.currentVersionId);
    const first = chain[0];
    const last = chain[chain.length - 1];
    const editorFromLabel = parseStandardLabel(first.label).editor || "";
    const editor = editorFromLabel || (first.authorId || "");
    const allStamps = Array.from(new Set(chain.flatMap(n => parseStandardLabel(n.label).stamps)));
    const aggregatedLabel = formatStandardLabel(editor, allStamps);
    const stamped = allStamps.length > 0;

    return (
      <div className="flex items-center gap-2 py-1">
        <div
          className={[
            "w-3 h-3 rounded-full",
            selectedInChain ? "bg-green-600" : "bg-gray-400",
            headInChain ? "ring-2 ring-offset-1 ring-green-600" : ""
          ].join(" ")}
        />
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => {
              onSelectVersion(last.id);
              loadVersion(last.id, false);
            }}
            className={[
              "text-xs px-2 py-0.5 rounded border",
              selectedInChain
                ? "bg-green-50 border-green-600 text-green-700"
                : (stamped ? "bg-blue-50 border-blue-600 text-blue-700" : "hover:bg-muted")
            ].join(" ")}
          >
            {aggregatedLabel || (last.id.slice(0, 8))}
          </button>
        </div>
        {headInChain ? (
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">HEAD</span>
        ) : null}
      </div>
    );
  };

  const TreeNode: React.FC<{ node: VersionNode; depth: number }> = ({ node, depth }) => {
    const chain: VersionNode[] = [node];
    let cursor = node;
    while (true) {
      const kids = childrenOf(cursor.id);
      if (kids.length !== 1) break;
      const only = kids[0];
      if (only.authorId !== node.authorId) break;
      chain.push(only);
      cursor = only;
    }
    const rest = childrenOf(cursor.id).filter(c => !chain.includes(c));
    return (
      <div className="ml-4" style={{ marginLeft: depth * 20 }}>
        <ChainRow chain={chain} />
        {rest.map(child => (
          <TreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  };

  const selectedNode = versions.find(v => v.id === selectedVersionId) || null;
  const info = selectedNode ? parseStandardLabel(selectedNode.label) : { editor: "", stamps: [] as string[] };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white max-h-[80vh] w-[90vw] md:w-[700px] rounded-lg shadow-lg p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Version History</h3>
          <Button variant="outline" size="icon" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div>
          {childrenOf(null).map(root => (
            <TreeNode key={root.id} node={root} depth={0} />
          ))}
        </div>
        {selectedNode ? (
          <div className="mt-4 rounded border p-3 text-sm">
            <div className="font-medium mb-1">Selected Node</div>
            <div className="grid grid-cols-1 gap-1">
              <div><span className="text-muted-foreground">Editor:</span> {info.editor || selectedNode.authorId || "Unknown"}</div>
              <div><span className="text-muted-foreground">Stampers:</span> {info.stamps.length ? info.stamps.join(", ") : "None"}</div>
              <div><span className="text-muted-foreground">Created:</span> {selectedNode.createdAt ? new Date(selectedNode.createdAt).toLocaleString() : "Unknown"}</div>
              <div><span className="text-muted-foreground">Id:</span> {selectedNode.id}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
