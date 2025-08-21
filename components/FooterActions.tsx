// components/FooterActions.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Trash2, Save } from "lucide-react";

interface Props {
  saving: boolean;
  hasUnsavedChanges: boolean;
  onDelete: () => void;
  onSave: () => void;
}

export default function FooterActions({
  saving,
  hasUnsavedChanges,
  onDelete,
  onSave
}: Props) {
  return (
    <footer className="flex justify-between">
      <Button variant="destructive" onClick={onDelete}>
        <Trash2 className="w-4 h-4 mr-2" /> Delete Item
      </Button>
      <Button onClick={onSave} disabled={saving || !hasUnsavedChanges}>
        <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Changes (Ctrl+S)"}
      </Button>
    </footer>
  );
}
