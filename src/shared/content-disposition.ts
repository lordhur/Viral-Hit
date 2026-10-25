/** RFC 5987 attachment header with an ASCII fallback and a UTF-8 filename. */
export function attachmentContentDisposition(value: string): string {
  const name = (value || "clip.mp4").replace(/[\u0000-\u001f\u007f\r\n"]/g, "_");
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/\\/g, "_") || "clip.mp4";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
