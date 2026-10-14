import { LABEL_COLORS, type LabelColor } from "@storageflow/domain";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui";

export interface ItemMenuProps {
  starred: boolean;
  writesEnabled: boolean;
  canRename: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canCreate: boolean;
  onStar: () => void;
  onColor: (color: LabelColor | null) => void;
  onRename: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onUpload: () => void;
  onProperties: () => void;
  onPreview?: () => void;
  children: ReactNode;
}

export function ItemMenu({ children, ...props }: ItemMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="explorer-menu">
        <ExplorerMenuItems {...props} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ExplorerMenuItems({
  starred,
  writesEnabled,
  canRename,
  canDelete,
  canMoveUp,
  canMoveDown,
  canCreate,
  onStar,
  onColor,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
  onNewFolder,
  onNewFile,
  onUpload,
  onProperties,
  onPreview,
}: Omit<ItemMenuProps, "children">) {
  const locked = !writesEnabled;
  return (
    <>
      {onPreview && <ContextMenuItem onSelect={onPreview}>Preview</ContextMenuItem>}
      <ContextMenuItem onSelect={onStar}>{starred ? "Unstar" : "Star"}</ContextMenuItem>
      <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Color label</div>
      {LABEL_COLORS.map((color) => (
        <ContextMenuItem key={color} onSelect={() => onColor(color)}>
          <span className={`mr-2 h-2.5 w-2.5 rounded-full ${swatch(color)}`} />
          {labelColorName(color)}
        </ContextMenuItem>
      ))}
      <ContextMenuItem onSelect={() => onColor(null)}>Clear label</ContextMenuItem>
      <ContextMenuItem disabled={locked || !canRename} onSelect={onRename}>
        Rename
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canMoveUp} onSelect={onMoveUp}>
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canMoveDown} onSelect={onMoveDown}>
        Move down
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canDelete} onSelect={onDelete}>
        Delete
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canCreate} onSelect={onNewFolder}>
        New folder
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canCreate} onSelect={onNewFile}>
        New file
      </ContextMenuItem>
      <ContextMenuItem disabled={locked || !canCreate} onSelect={onUpload}>
        Upload
      </ContextMenuItem>
      <ContextMenuItem onSelect={onProperties}>Properties</ContextMenuItem>
    </>
  );
}

export function DeleteConfirm({
  open,
  title,
  description,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onClick={onConfirm}>
              Delete
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function labelColorName(color: LabelColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

function swatch(color: LabelColor): string {
  const tones: Record<LabelColor, string> = {
    red: "bg-red-600",
    orange: "bg-orange-500",
    yellow: "bg-yellow-400",
    green: "bg-green-600",
    blue: "bg-blue-600",
    purple: "bg-purple-600",
    pink: "bg-pink-500",
    gray: "bg-neutral-400",
  };
  return tones[color];
}
