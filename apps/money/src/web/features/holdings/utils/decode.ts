/** A broker export's text: UTF-8 if it is valid, else Windows-1252, which is how a pound sign in older exports reads. */
export const decodeExport = (bytes: ArrayBuffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};
