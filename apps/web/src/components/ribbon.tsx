import type { PathSegment, SearchHit } from "@storageflow/domain";
import {
  BookOpen,
  CircleHelp,
  Copy,
  Download,
  Eraser,
  Eye,
  FileOutput,
  FilePlus,
  FileSearch,
  Files,
  FolderInput,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Globe,
  Mail,
  Minus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Scan,
  Scissors,
  Settings,
  Share2,
  Tags,
  Send,
  Trash2,
  Upload,
  Wrench,
  Zap,
  ArrowUp,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input } from "@/components/ui";
import {
  RIBBON_ACTION_WIDTH,
  RIBBON_TABS,
  comingSoonCopy,
  disabledReason,
  fitRibbonRow,
  groupsForTab,
  isActionEnabled,
  issueUrl,
  parentCrumb,
  ribbonAction,
  statusLabel,
  type RibbonAction,
  type RibbonActionId,
  type RibbonSelection,
  type RibbonTab,
} from "@/lib/ribbon";

const ICONS: Record<RibbonActionId, LucideIcon> = {
  cabinets: FolderKanban,
  open: FolderOpen,
  email: Mail,
  scan: Scan,
  ocr: FileSearch,
  portal: Globe,
  split: Scissors,
  preview: Eye,
  tools: Wrench,
  move: FolderInput,
  namings: Tags,
  templates: Files,
  separators: Minus,
  cleanup: Eraser,
  actions: Zap,
  convert: RefreshCw,
  combine: Copy,
  extract: FileOutput,
  settings: Settings,
  guide: BookOpen,
  help: CircleHelp,
  "new-folder": FolderPlus,
  "new-file": FilePlus,
  upload: Upload,
  rename: Pencil,
  delete: Trash2,
  share: Share2,
  download: Download,
  publish: Send,
};

export function FileCenterRibbon({
  tab,
  onTabChange,
  selection,
  onAction,
  searchValue,
  onSearchValue,
  onSearch,
  hits,
  searching,
  onOpenHit,
  rowWidth,
}: {
  tab: RibbonTab;
  onTabChange: (tab: RibbonTab) => void;
  selection: RibbonSelection;
  onAction: (id: RibbonActionId) => void;
  /** Fixed row width for tests. The live ribbon measures itself. */
  rowWidth?: number;
  searchValue: string;
  onSearchValue: (value: string) => void;
  onSearch: () => void;
  hits: SearchHit[] | null;
  searching: boolean;
  onOpenHit: (hit: SearchHit) => void;
}) {
  const [soon, setSoon] = useState<RibbonAction | null>(null);

  function press(id: RibbonActionId) {
    const action = ribbonAction(id);
    if (!isActionEnabled(id, selection)) return;
    if (action.availability === "soon") {
      setSoon(action);
      return;
    }
    onAction(id);
  }

  return (
    <div className="ribbon" data-testid="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="File Center">
        {RIBBON_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`ribbon-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`ribbon-panel-${name}`}
            className="ribbon-tab"
            data-ribbon-tab={name}
            onClick={() => onTabChange(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="ribbon-panel" role="tabpanel" id={`ribbon-panel-${tab}`} aria-labelledby={`ribbon-tab-${tab}`}>
        {tab === "Search" ? (
          <SearchPanel
            value={searchValue}
            onValue={onSearchValue}
            onSearch={onSearch}
            hits={hits}
            searching={searching}
            onOpenHit={onOpenHit}
          />
        ) : (
          <RibbonActionRow
            groups={groupsForTab(tab)}
            selection={selection}
            rowWidth={rowWidth}
            note={tab === "Inbox" ? "Incoming mail will show up here." : undefined}
            onPress={press}
          />
        )}
      </div>
      <Dialog open={!!soon} onOpenChange={(open) => !open && setSoon(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{soon?.label} is coming soon</DialogTitle>
            <DialogDescription>{soon ? comingSoonCopy(soon) : ""}</DialogDescription>
          </DialogHeader>
          {soon?.issue != null && (
            <a className="text-sm text-[#1d4ed8] underline" href={issueUrl(soon.issue)} target="_blank" rel="noreferrer">
              Issue #{soon.issue}
            </a>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RibbonActionRow({
  groups,
  selection,
  rowWidth,
  note,
  onPress,
}: {
  groups: readonly (readonly RibbonActionId[])[];
  selection: RibbonSelection;
  rowWidth?: number;
  note?: string;
  onPress: (id: RibbonActionId) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || rowWidth != null) return;
    const apply = () => setMeasured(node.clientWidth);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rowWidth]);
  const available = rowWidth ?? (measured > 0 ? measured : Number.POSITIVE_INFINITY);
  const layout = fitRibbonRow(groups, available);

  return (
    <>
      {note && <span className="ribbon-sr">{note}</span>}
    <div
      ref={ref}
      className="ribbon-row"
      data-testid="ribbon-row"
      data-ribbon-rows="1"
      data-overflow-count={layout.overflow.length}
      style={{ flexWrap: "nowrap" }}
    >
      {layout.visible.flatMap((item) => {
        const nodes = [
          <RibbonButton key={item.id} id={item.id} selection={selection} onPress={onPress} />,
        ];
        if (item.ruleBefore) {
          nodes.unshift(<span key={`${item.id}-rule`} className="ribbon-rule" aria-hidden="true" />);
        }
        return nodes;
      })}
      {layout.overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ribbon-action" aria-label="More actions" data-overflow="true" style={{ width: RIBBON_ACTION_WIDTH }}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              <span className="label">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {layout.overflow.map((id) => {
              const action = ribbonAction(id);
              const enabled = isActionEnabled(id, selection);
              const soonLabel = action.availability === "soon";
              return (
                <DropdownMenuItem key={id} disabled={!enabled} data-action={id} onSelect={() => onPress(id)}>
                  {soonLabel ? `${action.label} (coming soon)` : action.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
    </>
  );
}

function RibbonButton({ id, selection, onPress }: { id: RibbonActionId; selection: RibbonSelection; onPress: (id: RibbonActionId) => void }) {
  const action = ribbonAction(id);
  const enabled = isActionEnabled(id, selection);
  const reason = disabledReason(id, selection);
  const Icon = ICONS[id];
  const soonLabel = action.availability === "soon";
  return (
    <button
      type="button"
      className="ribbon-action"
      data-action={id}
      data-soon={soonLabel ? "true" : "false"}
      data-live={action.availability === "live" ? "true" : "false"}
      disabled={!enabled}
      aria-label={soonLabel ? `${action.label}, coming soon` : action.label}
      title={reason ?? (soonLabel ? "Coming soon" : action.label)}
      style={{ width: RIBBON_ACTION_WIDTH }}
      onClick={() => onPress(id)}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="label">{action.label}</span>
      {soonLabel && <span className="soon">Soon</span>}
    </button>
  );
}

function SearchPanel({
  value,
  onValue,
  onSearch,
  hits,
  searching,
  onOpenHit,
}: {
  value: string;
  onValue: (value: string) => void;
  onSearch: () => void;
  hits: SearchHit[] | null;
  searching: boolean;
  onOpenHit: (hit: SearchHit) => void;
}) {
  return (
    <form
      className="ribbon-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <Input
        aria-label="Search names"
        placeholder="Search file and folder names"
        value={value}
        onChange={(event) => onValue(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={searching}>
        Search
      </Button>
      {hits && (
        <ul className="ribbon-hits" aria-label="Name search results">
          {hits.length === 0 && <li className="px-2 py-2 text-sm text-[var(--ink-soft)]">No names match</li>}
          {hits.map((hit) => (
            <li key={hit.node.id}>
              <button type="button" className="ribbon-hit" onClick={() => onOpenHit(hit)}>
                <span className="truncate">{hit.node.name}</span>
                <span className="text-xs text-[var(--ink-soft)]">{hit.drawerName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export function LocationBar({
  crumbs,
  rootFolderId,
  backendPath,
  onOpen,
  onUp,
}: {
  crumbs: PathSegment[];
  rootFolderId: string;
  backendPath: string;
  onOpen: (crumb: PathSegment) => void;
  onUp: () => void;
}) {
  const up = parentCrumb(crumbs, rootFolderId);
  return (
    <div className="path-bar" data-testid="path-bar" title={backendPath || undefined}>
      <button type="button" className="path-up" aria-label="Up" disabled={!up} onClick={onUp}>
        <ArrowUp className="h-4 w-4" />
      </button>
      <nav aria-label="Current location" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {crumbs.length === 0 && <span className="text-[var(--ink-soft)]">No location</span>}
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.kind}-${crumb.id}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <span className="text-[var(--ink-soft)]">/</span>}
            <button type="button" className="crumb" onClick={() => onOpen(crumb)}>
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>
    </div>
  );
}

export function StatusCounts({ selected, folders, files }: { selected: number; folders: number; files: number }) {
  return (
    <p className="status-counts" data-testid="status-counts">
      {statusLabel(selected, folders, files)}
    </p>
  );
}
