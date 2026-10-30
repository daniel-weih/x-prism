// MyMemory limits query size in UTF-8 bytes, not JavaScript character count.
export function splitForMyMemory(text, limit = 450) {
  const encoder = new TextEncoder();
  const chunks = [];
  let chunk = "", bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > limit && chunk) {
      const boundary = Math.max(chunk.lastIndexOf(" "), chunk.lastIndexOf("\n"), chunk.lastIndexOf("。"), chunk.lastIndexOf(". "));
      const cut = boundary > chunk.length * 0.55 ? boundary + 1 : chunk.length;
      chunks.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
      bytes = encoder.encode(chunk).length;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function myMemoryTranslation(body) {
  if (body?.responseStatus != null && Number(body.responseStatus) !== 200) {
    throw new Error(`MyMemory translation failed (${body.responseStatus}). Check the language pair or try again later.`);
  }
  const text = body?.responseData?.translatedText;
  if (typeof text !== "string" || !text.trim()) throw new Error("MyMemory returned no translation.");
  return text;
}
