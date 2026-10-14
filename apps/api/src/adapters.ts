import type { ObjectBinding, StorageAdapter } from "@storageflow/storage";
import { MemoryAdapter, S3Adapter } from "@storageflow/storage";

export interface AdapterResolver {
  forBinding(binding: ObjectBinding): StorageAdapter;
}

export function createResolver(mode: "s3" | "memory"): AdapterResolver {
  const cache = new Map<string, StorageAdapter>();
  return {
    forBinding(binding) {
      const cacheKey = [binding.kind, binding.endpoint, binding.bucket, binding.prefix, binding.accessKeyId, binding.secretAccessKey].join("|");
      const existing = cache.get(cacheKey);
      if (existing) return existing;
      const useMemory = mode === "memory" || binding.endpoint.startsWith("memory:");
      const adapter = useMemory
        ? new MemoryAdapter(binding.kind, binding.prefix, {
            offlineMessage: binding.secretAccessKey === "bad-secret" ? "The access key is invalid" : null,
            failWrites: binding.endpoint.includes("flaky"),
          })
        : new S3Adapter(binding);
      cache.set(cacheKey, adapter);
      return adapter;
    },
  };
}
