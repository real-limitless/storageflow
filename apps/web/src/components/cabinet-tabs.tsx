import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LocationTab } from "@storageflow/domain";
import { X } from "lucide-react";
import { cabinetTabId } from "@/lib/cabinets";

export function CabinetTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
}: {
  tabs: LocationTab[];
  activeId: string;
  onActivate: (tab: LocationTab) => void;
  onClose: (projectId: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = tabs.map((tab) => cabinetTabId(tab));

  function onDragEnd(event: DragEndEvent) {
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : "";
    if (!over || active === over) return;
    onReorder(active, over);
  }

  if (!tabs.length) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex items-end gap-1 overflow-x-auto px-4 pt-3" role="tablist" aria-label="Open cabinets">
        <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => (
            <CabinetTab key={cabinetTabId(tab)} tab={tab} active={cabinetTabId(tab) === activeId} onActivate={() => onActivate(tab)} onClose={() => onClose(cabinetTabId(tab))} />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}

function CabinetTab({ tab, active, onActivate, onClose }: { tab: LocationTab; active: boolean; onActivate: () => void; onClose: () => void }) {
  const id = cabinetTabId(tab);
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="place-tab"
      id={`cabinet-tab-${id}`}
      data-active={active}
      data-path={tab.url}
      data-select={tab.select ?? ""}
      onClick={onActivate}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onKeyDown={(event) => {
        listeners?.onKeyDown?.(event);
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <span className="max-w-40 truncate">{tab.title}</span>
      <button
        type="button"
        className="place-tab-close"
        aria-label={`Close ${tab.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
