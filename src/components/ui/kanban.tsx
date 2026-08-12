"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
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
import { Slot } from "radix-ui";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
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
  /**
   * When supplied, moving a card is owned by the caller. This is the seam for a
   * domain command; the primitive never pretends that rearranging pixels is a
   * successful warehouse transaction.
   */
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

interface SortableHandleContextValue {
  readonly attributes?: ReturnType<typeof useSortable>["attributes"];
  readonly listeners: ReturnType<typeof useSortable>["listeners"];
  readonly isDragging: boolean;
  readonly disabled: boolean;
}

const ColumnHandleContext = createContext<SortableHandleContextValue>({
  listeners: undefined,
  isDragging: false,
  disabled: false,
});

const ItemHandleContext = createContext<
  Omit<SortableHandleContextValue, "attributes">
>({ listeners: undefined, isDragging: false, disabled: false });

const dropAnimation: DropAnimation = {
  sideEffects: ({ active }) => {
    active.node.style.opacity = "0.4";
    return () => {
      active.node.style.opacity = "";
    };
  },
};

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
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id: value, disabled });
  const style: CSSProperties = {
    transition,
    transform: CSS.Translate.toString(transform),
  };
  const handle = useMemo<SortableHandleContextValue>(
    () => ({
      attributes,
      listeners,
      isDragging,
      disabled,
    }),
    [attributes, disabled, isDragging, listeners],
  );

  return (
    <ColumnHandleContext.Provider value={handle}>
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
    </ColumnHandleContext.Provider>
  );
}

export function KanbanColumnHandle({
  asChild = false,
  cursor = true,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly asChild?: boolean;
  readonly cursor?: boolean;
}) {
  const handle = useContext(ColumnHandleContext);
  const Component = asChild ? Slot.Root : "div";
  return (
    <Component
      data-slot="kanban-column-handle"
      data-dragging={handle.isDragging}
      data-disabled={handle.disabled}
      {...handle.attributes}
      {...handle.listeners}
      className={cn(
        "opacity-0 transition-opacity group-hover/kanban-column:opacity-100",
        cursor && (handle.isDragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export function KanbanItem({
  value,
  asChild = false,
  className,
  children,
  disabled = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly value: UniqueIdentifier;
  readonly asChild?: boolean;
  readonly disabled?: boolean;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id: value, disabled });
  const { activeId, isColumn } = useContext(KanbanContext);
  const style: CSSProperties = {
    transition,
    transform: CSS.Translate.toString(transform),
  };
  const Component = asChild ? Slot.Root : "div";
  const handle = useMemo(
    () => ({
      listeners,
      isDragging: activeId === null ? false : !isColumn(activeId),
      disabled,
    }),
    [activeId, disabled, isColumn, listeners],
  );

  return (
    <ItemHandleContext.Provider value={handle}>
      <Component
        ref={setNodeRef}
        style={style}
        data-slot="kanban-item"
        data-value={String(value)}
        data-dragging={isDragging}
        data-disabled={disabled}
        {...attributes}
        className={cn(isDragging && "opacity-50", className)}
        {...props}
      >
        {children}
      </Component>
    </ItemHandleContext.Provider>
  );
}

export function KanbanItemHandle({
  asChild = false,
  cursor = true,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly asChild?: boolean;
  readonly cursor?: boolean;
}) {
  const handle = useContext(ItemHandleContext);
  const Component = asChild ? Slot.Root : "div";
  return (
    <Component
      data-slot="kanban-item-handle"
      data-dragging={handle.isDragging}
      data-disabled={handle.disabled}
      {...handle.listeners}
      className={cn(
        cursor && (handle.isDragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
      {...props}
    >
      {children}
    </Component>
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

export function KanbanOverlay({
  children,
  className,
}: {
  readonly children:
    | ReactNode
    | ((active: {
        readonly value: UniqueIdentifier;
        readonly variant: "column" | "item";
      }) => ReactNode);
  readonly className?: string;
}) {
  const { activeId, isColumn } = useContext(KanbanContext);
  const content = useMemo(() => {
    if (activeId === null) return null;
    return typeof children === "function"
      ? children({
          value: activeId,
          variant: isColumn(activeId) ? "column" : "item",
        })
      : children;
  }, [activeId, children, isColumn]);

  return (
    <DragOverlay dropAnimation={dropAnimation}>
      <div
        data-slot="kanban-overlay"
        data-dragging={activeId !== null}
        className={cn("pointer-events-none cursor-grabbing", className)}
      >
        {content}
      </div>
    </DragOverlay>
  );
}

export type KanbanColumnProps = ComponentProps<typeof KanbanColumn>;
export type KanbanItemProps = ComponentProps<typeof KanbanItem>;
