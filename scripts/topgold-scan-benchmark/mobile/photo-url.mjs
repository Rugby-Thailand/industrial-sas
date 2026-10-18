/** Validate and encode a locally created photo URL for an image URL property. */
export function photoPreviewUrl(url, origin) {
  const parsed = new URL(url);
  if (parsed.protocol !== "blob:" || parsed.origin !== origin)
    throw new Error("Expected a same-origin photo blob URL");
  return encodeURI(url);
}
