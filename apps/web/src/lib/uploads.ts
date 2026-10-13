import { useSyncExternalStore } from "react";

export interface UploadTask {
  id: string;
  name: string;
  folderId: string;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  file: File;
}

const tasks = new Map<string, UploadTask>();
const listeners = new Set<() => void>();
let snapshot: UploadTask[] = [];

function emit() {
  snapshot = [...tasks.values()];
  for (const listener of listeners) listener();
}

export const uploads = {
  add(task: UploadTask) {
    tasks.set(task.id, task);
    emit();
  },
  update(id: string, patch: Partial<UploadTask>) {
    const current = tasks.get(id);
    if (!current) return;
    tasks.set(id, { ...current, ...patch });
    emit();
  },
  list(): UploadTask[] {
    return snapshot;
  },
};

export function useUploads(): UploadTask[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}
