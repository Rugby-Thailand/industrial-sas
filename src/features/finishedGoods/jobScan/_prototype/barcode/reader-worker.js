/* global importScripts */
importScripts("/zxing-wasm.js");
self.onmessage = async (event) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  const { data } = event;
  try {
    const { decodePhoto } = await import("./decoder.js");
    const result = await decodePhoto(
      data.image,
      data.target,
      () => false,
      () => {},
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    data.image.close();
  }
};
