"use client";

import { cn } from "@/lib/utils";
import { ChevronRight, File, Folder, FolderOpen, Receipt, Clock, FileText, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";

type TreeContextType = {
  expandedIds: Set<string>;
  selectedIds: string[];
  toggleExpanded: (nodeId: string) => void;
  handleSelection: (nodeId: string, ctrlKey?: boolean) => void;
  showLines?: boolean;
  showIcons?: boolean;
  selectable?: boolean;
  multiSelect?: boolean;
  indent: number;
};

const TreeContext = createContext<TreeContextType | undefined>(undefined);

function useTree() {
  const ctx = useContext(TreeContext);
  if (!ctx) throw new Error("Tree components must be used within a TreeProvider");
  return ctx;
}

type TreeNodeContextType = {
  nodeId: string;
  level: number;
  isLast: boolean;
  isFolder?: boolean;
  parentPath: boolean[];
};

const TreeNodeContext = createContext<TreeNodeContextType | undefined>(undefined);

function useTreeNode() {
  const ctx = useContext(TreeNodeContext);
  if (!ctx) throw new Error("TreeNode components must be used within a TreeNode");
  return ctx;
}

export type TreeProviderProps = {
  children: ReactNode;
  defaultExpandedIds?: string[];
  showLines?: boolean;
  showIcons?: boolean;
  selectable?: boolean;
  multiSelect?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  indent?: number;
  className?: string;
};

export function TreeProvider({
  children,
  defaultExpandedIds = [],
  showLines = true,
  showIcons = true,
  selectable = true,
  multiSelect = false,
  selectedIds: controlledIds,
  onSelectionChange,
  indent = 20,
  className,
}: TreeProviderProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(defaultExpandedIds));
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>(controlledIds ?? []);

  const isControlled = controlledIds !== undefined && onSelectionChange !== undefined;
  const currentSelectedIds = isControlled ? controlledIds : internalSelectedIds;

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleSelection = useCallback(
    (nodeId: string) => {
      if (!selectable) return;
      let next: string[];
      if (multiSelect && currentSelectedIds.includes(nodeId))
        next = currentSelectedIds.filter((id) => id !== nodeId);
      else next = currentSelectedIds.includes(nodeId) ? [] : [nodeId];

      if (!isControlled) setInternalSelectedIds(next);
      onSelectionChange?.(next);
    },
    [selectable, multiSelect, currentSelectedIds, isControlled, onSelectionChange]
  );

  return (
    <TreeContext.Provider
      value={{ expandedIds, selectedIds: currentSelectedIds, toggleExpanded, handleSelection, showLines, showIcons, selectable, multiSelect, indent }}
    >
      <div className={cn("w-full", className)}>{children}</div>
    </TreeContext.Provider>
  );
}

export type TreeViewProps = HTMLAttributes<HTMLDivElement>;
export function TreeView({ className, children, ...props }: TreeViewProps) {
  return <div className={cn("p-2", className)} {...props}>{children}</div>;
}

export type TreeNodeProps = HTMLAttributes<HTMLDivElement> & {
  nodeId?: string;
  level?: number;
  isLast?: boolean;
  isFolder?: boolean;
  parentPath?: boolean[];
  children?: ReactNode;
};

export function TreeNode({
  nodeId: providedNodeId,
  level = 0,
  isLast = false,
  parentPath = [],
  isFolder = false,
  children,
  className,
  ...props
}: TreeNodeProps) {
  const generatedId = useId();
  const nodeId = providedNodeId ?? generatedId;
  const currentPath = useMemo(() => {
    const p = level === 0 ? [] : [...parentPath];
    while (p.length < level - 1) p.push(false);
    if (level > 0) p[level - 1] = isLast;
    return p;
  }, [level, isLast, parentPath]);

  return (
    <TreeNodeContext.Provider value={{ nodeId, level, isLast, parentPath: currentPath, isFolder }}>
      <div className={cn("select-none", className)} {...props}>{children}</div>
    </TreeNodeContext.Provider>
  );
}

export type TreeNodeTriggerProps = ComponentProps<typeof motion.div>;
export function TreeNodeTrigger({ children, className, onClick, ...props }: TreeNodeTriggerProps) {
  const { selectedIds, toggleExpanded, handleSelection, indent } = useTree();
  const { nodeId, level, isFolder } = useTreeNode();
  const isSelected = selectedIds.includes(nodeId);

  return (
    <motion.div
      className={cn(
        "group relative mx-1 flex cursor-pointer items-center rounded-md px-3 py-2 transition-all duration-200",
        "dark:hover:bg-neutral-800/60 hover:bg-neutral-200",
        isSelected && "bg-neutral-200 dark:bg-neutral-800/60",
        className
      )}
      onClick={(e) => {
        toggleExpanded(nodeId);
        if (!isFolder) handleSelection(nodeId);
        onClick?.(e);
      }}
      style={{ paddingLeft: level * indent + 8 }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
      {...props}
    >
      <TreeLines />
      {children as ReactNode}
    </motion.div>
  );
}

export function TreeLines() {
  const { showLines, indent } = useTree();
  const { level, isLast, parentPath } = useTreeNode();
  if (!showLines || level === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0">
      {Array.from({ length: level }, (_, i) => {
        const l = i * indent + 12;
        if (parentPath[i] && i === level - 1) return null;
        return (
          <div key={l} className="absolute inset-y-0 border-l dark:border-neutral-800" style={{ left: l, display: parentPath[i] ? "none" : "block" }} />
        );
      })}
      <div className="absolute top-1/2 border-t dark:border-neutral-800" style={{ left: (level - 1) * indent + 12, width: indent - 4, transform: "translateY(-1px)" }} />
      {isLast && <div className="absolute top-0 border-l dark:border-neutral-800" style={{ left: (level - 1) * indent + 12, height: "50%" }} />}
    </div>
  );
}

export type TreeNodeContentProps = ComponentProps<typeof motion.div> & { hasChildren?: boolean };
export function TreeNodeContent({ children, hasChildren = false, className, ...props }: TreeNodeContentProps) {
  const { expandedIds } = useTree();
  const { nodeId } = useTreeNode();
  const isExpanded = expandedIds.has(nodeId);

  return (
    <AnimatePresence>
      {hasChildren && isExpanded && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
        >
          <motion.div
            animate={{ y: 0 }}
            className={className}
            exit={{ y: -10 }}
            initial={{ y: -10 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            {...props}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type TreeExpanderProps = ComponentProps<typeof motion.div> & { hasChildren?: boolean };
export function TreeExpander({ hasChildren = false, className, ...props }: TreeExpanderProps) {
  const { expandedIds } = useTree();
  const { nodeId } = useTreeNode();
  const isExpanded = expandedIds.has(nodeId);
  if (!hasChildren) return <div className="mr-1 h-4 w-4" />;

  return (
    <motion.div
      animate={{ rotate: isExpanded ? 90 : 0 }}
      className={cn("mr-1 flex h-4 w-4 cursor-pointer items-center justify-center", className)}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      {...props}
    >
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
    </motion.div>
  );
}

export type TreeIconProps = ComponentProps<typeof motion.div> & { icon?: ReactNode; ext?: string };
export function TreeIcon({ icon, ext, className, ...props }: TreeIconProps) {
  const { showIcons, expandedIds } = useTree();
  const { nodeId, isFolder } = useTreeNode();
  if (!showIcons) return null;
  const isExpanded = expandedIds.has(nodeId);

  const defaultIcon = isFolder
    ? isExpanded
      ? <FolderOpen className="h-4 w-4 text-amber-500" />
      : <Folder className="h-4 w-4 text-amber-500" />
    : ext === "boleta"
      ? <Receipt className="h-4 w-4 text-blue-500" />
      : ext === "documento"
        ? <FileText className="h-4 w-4 text-orange-500" />
        : ext === "propuesta"
          ? <Search className="h-4 w-4 text-purple-500" />
          : <Clock className="h-4 w-4 text-green-500" />;

  return (
    <motion.div
      className={cn("mr-2 flex h-4 w-4 items-center justify-center text-muted-foreground", className)}
      whileHover={{ scale: 1.1 }}
      transition={{ duration: 0.15 }}
      {...props}
    >
      {icon || defaultIcon}
    </motion.div>
  );
}

export type TreeLabelProps = HTMLAttributes<HTMLSpanElement>;
export function TreeLabel({ className, ...props }: TreeLabelProps) {
  return <span className={cn("flex-1 truncate text-sm text-primary/70", className)} {...props} />;
}
