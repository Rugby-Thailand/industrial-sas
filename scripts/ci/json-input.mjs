// JSON inputs used as security evidence must not silently overwrite keys.
// JSON.parse validates syntax first; this second pass checks decoded keys.
export function parseUniqueJson(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw new Error("JSON input exceeds the supported bound");
  const parsed = JSON.parse(text);
  let cursor = 0;
  const whitespace = () => {
    while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++;
  };
  const string = () => {
    const start = cursor++;
    while (cursor < text.length) {
      const character = text[cursor++];
      if (character === "\\") cursor++;
      else if (character === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error("Invalid JSON string");
  };
  const value = (depth) => {
    if (depth > 128) throw new Error("JSON input exceeds the supported depth");
    whitespace();
    if (text[cursor] === "{") {
      cursor++;
      whitespace();
      const keys = new Set();
      if (text[cursor] === "}") {
        cursor++;
        return;
      }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new Error("Duplicate JSON object key");
        keys.add(key);
        whitespace();
        cursor++; // Colon: syntax was already validated by JSON.parse.
        value(depth + 1);
        whitespace();
        if (text[cursor++] === "}") return;
      }
    } else if (text[cursor] === "[") {
      cursor++;
      whitespace();
      if (text[cursor] === "]") {
        cursor++;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        if (text[cursor++] === "]") return;
      }
    } else if (text[cursor] === '"') string();
    else {
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor++;
    }
  };
  value(0);
  whitespace();
  if (cursor !== text.length) throw new Error("Invalid JSON input");
  return parsed;
}
