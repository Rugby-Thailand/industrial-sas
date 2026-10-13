"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_PHOTOS = 20;
const MAX_BYTES = 25 * 1024 * 1024;

type Photo = { id: number; file: File; preview: string };
type PhotoProblem = "imageType" | "imageSize" | "photoLimit";

function sameFile(a: File, b: File) {
  return (
    a.name === b.name &&
    a.size === b.size &&
    a.type === b.type &&
    a.lastModified === b.lastModified
  );
}

/** Owns collection previews only; submitted tickets create their own previews. */
export function usePhotoSelection(capacity = MAX_PHOTOS) {
  const limit = Math.min(MAX_PHOTOS, Math.max(0, capacity));
  const nextId = useRef(0);
  // Camera delivery and gallery events can arrive before React renders the limit.
  const collected = useRef<Photo[]>([]);
  const active = useRef(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [problem, setProblem] = useState<PhotoProblem>();

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      for (const photo of collected.current) URL.revokeObjectURL(photo.preview);
      collected.current = [];
    };
  }, []);

  function commit(next: Photo[]) {
    collected.current = next;
    setPhotos(next);
  }

  function add(
    files: readonly File[],
    source: "gallery" | "camera" = "gallery",
  ) {
    if (!active.current) return;
    const accepted: File[] = [];
    let found: PhotoProblem | undefined;
    for (const file of files) {
      // Distinct camera shots remain separate even when name and size coincide.
      if (
        source === "gallery" &&
        (collected.current.some((photo) => sameFile(photo.file, file)) ||
          accepted.some((candidate) => sameFile(candidate, file)))
      )
        continue;
      if (!file.type.startsWith("image/")) found = "imageType";
      else if (!file.size || file.size > MAX_BYTES) found = "imageSize";
      else accepted.push(file);
    }
    // Keep an oversized gallery/camera acquisition atomic and allocate no
    // previews until its complete valid set fits the remaining group.
    if (collected.current.length + accepted.length > limit) {
      setProblem("photoLimit");
      return;
    }
    if (accepted.length)
      commit([
        ...collected.current,
        ...accepted.map((file) => ({
          id: nextId.current++,
          file,
          preview: URL.createObjectURL(file),
        })),
      ]);
    setProblem(found);
  }

  function clear() {
    for (const photo of collected.current) URL.revokeObjectURL(photo.preview);
    collected.current = [];
    if (!active.current) return;
    setPhotos([]);
    setProblem(undefined);
  }

  function remove(id: number) {
    if (!active.current) return;
    const photo = collected.current.find((item) => item.id === id);
    if (!photo) return;
    URL.revokeObjectURL(photo.preview);
    commit(collected.current.filter((item) => item.id !== id));
    setProblem(undefined);
  }

  return {
    limit,
    photos,
    problem,
    add,
    remove,
    clear,
    getFiles: () => collected.current.map((photo) => photo.file),
    canCapture: () => active.current && collected.current.length < limit,
  };
}
