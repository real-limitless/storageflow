export interface TreeItem {
  id: string;
  parentId: string | null;
}

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
}

export function buildTree<T extends TreeItem>(items: readonly T[], rootId: string): TreeNode<T>[] {
  const byParent = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (item.id === rootId || seen.has(item.id)) continue;
    seen.add(item.id);
    const parentId = item.parentId ?? "";
    const list = byParent.get(parentId) ?? [];
    list.push(item);
    byParent.set(parentId, list);
  }
  const walk = (parentId: string, ancestors: Set<string>): TreeNode<T>[] => {
    const children = byParent.get(parentId) ?? [];
    return children.map((item) => {
      if (ancestors.has(item.id)) return { item, children: [] };
      const next = new Set(ancestors);
      next.add(item.id);
      return { item, children: walk(item.id, next) };
    });
  };
  return walk(rootId, new Set([rootId]));
}

export function flattenTree<T>(nodes: readonly TreeNode<T>[], expanded: ReadonlySet<string>, idOf: (item: T) => string): T[] {
  const out: T[] = [];
  const visit = (list: readonly TreeNode<T>[]) => {
    for (const node of list) {
      out.push(node.item);
      if (expanded.has(idOf(node.item))) visit(node.children);
    }
  };
  visit(nodes);
  return out;
}
