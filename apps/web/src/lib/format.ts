import { extensionOf, type LabelColor } from "@storageflow/domain";

export function formatBytes(size: number | null | undefined): string {
  if (size == null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function fileKind(name: string, contentType: string | null): "image" | "pdf" | "text" | "audio" | "video" | "other" {
  const type = contentType ?? "";
  const extension = extensionOf(name);
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return "image";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(extension)) return "audio";
  if (type.startsWith("video/") || ["mp4", "webm", "mov"].includes(extension)) return "video";
  if (type.startsWith("text/") || ["txt", "md", "json", "csv", "log"].includes(extension)) return "text";
  return "other";
}

export const COLOR_CLASS: Record<LabelColor, string> = {
  red: "bg-red-600",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-600",
  blue: "bg-blue-600",
  purple: "bg-purple-600",
  pink: "bg-pink-500",
  gray: "bg-neutral-400",
};
