let previews: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

export function previewUrls(): ReadonlyMap<string, string> {
  return previews;
}

export function subscribeToPreviews(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function hasPreview(id: string): boolean {
  return previews.has(id);
}

export function setPreview(id: string, url: string): void {
  if (previews.has(id)) {
    return;
  }

  const next = new Map(previews);
  next.set(id, url);
  previews = next;

  for (const listener of listeners) {
    listener();
  }
}

export function forgetPreviews(): void {
  for (const url of previews.values()) {
    URL.revokeObjectURL(url);
  }

  previews = new Map();
  for (const listener of listeners) {
    listener();
  }
}
