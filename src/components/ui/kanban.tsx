"use client";

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

type BoardValue<Item> = Record<string, Item[]>;

export interface KanbanMoveEvent {
  readonly event: DragEndEvent;
  readonly activeContainer: string;
  readonly activeIndex: number;
  readonly overContainer: string;
  readonly overIndex: number;
}

export interface KanbanProps<Item> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  readonly value: BoardValue<Item>;
  readonly onValueChange: (value: BoardValue<Item>) => void;
  readonly getItemValue: (item: Item) => UniqueIdentifier;

  readonly onMove?: (move: KanbanMoveEvent) => void;
}

interface KanbanContextValue {
  readonly columns: BoardValue<unknown>;
  readonly columnIds: readonly string[];
  readonly activeId: UniqueIdentifier | null;
  readonly getItemId: (item: unknown) => UniqueIdentifier;
  readonly isColumn: (value: UniqueIdentifier) => boolean;
}

const KanbanContext = createContext<KanbanContextValue>({
  columns: {},
  columnIds: [],
  activeId: null,
  getItemId: () => "",
  isColumn: () => false,
});

export function Kanban<Item>({
  value,
  onValueChange,
  getItemValue,
  children,
  className,
  onMove,
  ...props
}: KanbanProps<Item>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const columnIds = useMemo(() => Object.keys(value), [value]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const isColumn = useCallback(
    (id: UniqueIdentifier) => columnIds.includes(String(id)),
    [columnIds],
  );
  const findContainer = useCallback(
    (id: UniqueIdentifier): string | undefined => {
      if (isColumn(id)) return String(id);
      return columnIds.find((column) =>
        value[column]?.some((item) => getItemValue(item) === id),
      );
    },
    [columnIds, getItemValue, isColumn, value],
  );

  const moveAcrossColumns = useCallback(
    (event: DragOverEvent) => {
      if (onMove !== undefined || isColumn(event.active.id)) return;
      if (event.over === null) return;

      const activeContainer = findContainer(event.active.id);
      const overContainer = findContainer(event.over.id);
      if (
        activeContainer === undefined ||
        overContainer === undefined ||
        activeContainer === overContainer
      ) {
        return;
      }

      const activeItems = [...(value[activeContainer] ?? [])];
      const overItems = [...(value[overContainer] ?? [])];
      const activeIndex = activeItems.findIndex(
        (item) => getItemValue(item) === event.active.id,
      );
      const overIndex = isColumn(event.over.id)
        ? overItems.length
        : overItems.findIndex((item) => getItemValue(item) === event.over?.id);
      const [moved] = activeItems.splice(activeIndex, 1);
      if (moved === undefined) return;
      overItems.splice(Math.max(0, overIndex), 0, moved);
      onValueChange({
        ...value,
        [activeContainer]: activeItems,
        [overContainer]: overItems,
      });
    },
    [findContainer, getItemValue, isColumn, onMove, onValueChange, value],
  );

  const finishMove = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      if (event.over === null) return;

      if (onMove !== undefined && !isColumn(event.active.id)) {
        const activeContainer = findContainer(event.active.id);
        const overContainer = findContainer(event.over.id);
        if (activeContainer === undefined || overContainer === undefined)
          return;
        onMove({
          event,
          activeContainer,
          activeIndex: (value[activeContainer] ?? []).findIndex(
            (item) => getItemValue(item) === event.active.id,
          ),
          overContainer,
          overIndex: isColumn(event.over.id)
            ? (value[overContainer] ?? []).length
            : (value[overContainer] ?? []).findIndex(
                (item) => getItemValue(item) === event.over?.id,
              ),
        });
        return;
      }

      if (isColumn(event.active.id) && isColumn(event.over.id)) {
        const activeIndex = columnIds.indexOf(String(event.active.id));
        const overIndex = columnIds.indexOf(String(event.over.id));
        if (activeIndex === overIndex) return;
        const ordered = arrayMove(columnIds, activeIndex, overIndex);
        onValueChange(
          Object.fromEntries(
            ordered.map((column) => [column, value[column] ?? []]),
          ),
        );
        return;
      }

      const container = findContainer(event.active.id);
      const overContainer = findContainer(event.over.id);
      if (container === undefined || container !== overContainer) return;
      const items = value[container] ?? [];
      const activeIndex = items.findIndex(
        (item) => getItemValue(item) === event.active.id,
      );
      const overIndex = items.findIndex(
        (item) => getItemValue(item) === event.over?.id,
      );
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return;
      onValueChange({
        ...value,
        [container]: arrayMove(items, activeIndex, overIndex),
      });
    },
    [
      columnIds,
      findContainer,
      getItemValue,
      isColumn,
      onMove,
      onValueChange,
      value,
    ],
  );

  const context = useMemo<KanbanContextValue>(
    () => ({
      columns: value as BoardValue<unknown>,
      columnIds,
      activeId,
      getItemId: getItemValue as (item: unknown) => UniqueIdentifier,
      isColumn,
    }),
    [activeId, columnIds, getItemValue, isColumn, value],
  );

  return (
    <KanbanContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        onDragStart={(event: DragStartEvent) => setActiveId(event.active.id)}
        onDragCancel={() => setActiveId(null)}
        onDragOver={moveAcrossColumns}
        onDragEnd={finishMove}
      >
        <div
          data-slot="kanban"
          data-dragging={activeId !== null}
          className={cn(className)}
          {...props}
        >
          {children}
        </div>
      </DndContext>
    </KanbanContext.Provider>
  );
}

export function KanbanBoard({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const { columnIds } = useContext(KanbanContext);
  return (
    <SortableContext
      items={[...columnIds]}
      strategy={horizontalListSortingStrategy}
    >
      <div
        data-slot="kanban-board"
        className={cn("grid auto-rows-fr gap-4 sm:grid-cols-3", className)}
        {...props}
      >
        {children}
      </div>
    </SortableContext>
  );
}

export function KanbanColumn({
  value,
  className,
  children,
  disabled = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly value: string;
  readonly disabled?: boolean;
}) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({
    id: value,
    disabled,
  });
  const style: CSSProperties = {
    transition,
    transform: CSS.Translate.toString(transform),
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-slot="kanban-column"
      data-value={value}
      data-dragging={isDragging}
      data-disabled={disabled}
      className={cn(
        "group/kanban-column flex flex-col",
        isDragging && "opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function KanbanColumnContent({
  value,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { readonly value: string }) {
  const { columns, getItemId } = useContext(KanbanContext);
  const items = useMemo(
    () => (columns[value] ?? []).map(getItemId),
    [columns, getItemId, value],
  );
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div
        data-slot="kanban-column-content"
        className={cn("flex flex-col gap-2", className)}
        {...props}
      >
        {children}
      </div>
    </SortableContext>
  );
}
