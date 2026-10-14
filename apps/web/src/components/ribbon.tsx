import type { PathSegment, SearchHit } from "@storageflow/domain";
import type { CabinetSearchMode } from "@/lib/search";
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
  searchMode = "name",
  onSearchMode,
  onAsk,
  semanticState = "idle",
  ragAnswer = "",
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
  searchMode?: CabinetSearchMode;
  onSearchMode?: (mode: CabinetSearchMode) => void;
  onAsk?: () => void;
  semanticState?: "idle" | "hits" | "empty" | "denied";
  ragAnswer?: string;
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
            mode={searchMode}
            onMode={onSearchMode}
            onAsk={onAsk}
            semanticState={semanticState}
            ragAnswer={ragAnswer}
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
  mode,
  onMode,
  onAsk,
  semanticState,
  ragAnswer,
}: {
  value: string;
  onValue: (value: string) => void;
  onSearch: () => void;
  hits: SearchHit[] | null;
  searching: boolean;
  onOpenHit: (hit: SearchHit) => void;
  mode: CabinetSearchMode;
  onMode?: (mode: CabinetSearchMode) => void;
  onAsk?: () => void;
  semanticState: "idle" | "hits" | "empty" | "denied";
  ragAnswer: string;
}) {
  const semantic = mode === "semantic";
  return (
    <div className="ribbon-search-panel">
      <form
        className="ribbon-search"
        data-testid="ribbon-search-row"
        data-ribbon-rows="1"
        style={{ flexWrap: "nowrap" }}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="search-mode" role="group" aria-label="Search mode" data-search-mode={mode}>
          <button type="button" aria-pressed={mode === "name"} onClick={() => onMode?.("name")}>Name</button>
          <button type="button" aria-pressed={mode === "semantic"} onClick={() => onMode?.("semantic")}>Semantic</button>
        </div>
        <Input
          aria-label={semantic ? "Search by meaning" : "Search names"}
          placeholder={semantic ? "Search by meaning" : "Search file and folder names"}
          value={value}
          onChange={(event) => onValue(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={searching}>
          Search
        </Button>
        {semantic && (
          <Button type="button" size="sm" disabled={searching} onClick={() => onAsk?.()}>
            Ask
          </Button>
        )}
      </form>
      {!semantic && hits && (
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
      {semantic && (
        <div className="meaning-strip" data-semantic-state={semanticState}>
          {semanticState === "idle" && !ragAnswer && <p className="meaning-note">Search by meaning, or ask a question about files you can open.</p>}
          {semanticState === "empty" && <p className="meaning-note" data-semantic-empty>No files match that meaning.</p>}
          {semanticState === "denied" && <p className="meaning-note" data-semantic-denied>You do not have access to search this cabinet.</p>}
          {ragAnswer && (
            <blockquote className="meaning-answer" data-rag-answer>
              <span className="pane-label">Answer</span>
              <p>{ragAnswer}</p>
            </blockquote>
          )}
          {semanticState === "hits" && hits && hits.length > 0 && (
            <ul className="meaning-hits" aria-label="Semantic search results">
              {hits.map((hit) => (
                <li key={hit.node.id} data-semantic-hit>
                  <button type="button" onClick={() => onOpenHit(hit)}>{hit.node.name}</button>
                  <span>{hit.drawerName}</span>
                  <span>{Math.round((hit.score ?? 0) * 100)}%</span>
                  {hit.snippet && <p>{hit.snippet}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
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
