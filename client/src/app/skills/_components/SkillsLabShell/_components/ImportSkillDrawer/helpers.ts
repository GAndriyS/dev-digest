import { SUPPORTED_EXTENSIONS } from "./constants";

/** True when the filename carries an extension the import endpoint accepts. */
export function isSupportedSkillFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Drop the `data:<mime>;base64,` prefix a FileReader data URL carries. The wire
 * contract is `content_base64`, not a data URL, and the mime the browser
 * guesses for a `.md` file is not something the server should have to parse.
 */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Read a picked file as base64.
 *
 * Lives here rather than in `lib/` because it is a browser-API read, not data
 * access: it never reaches the network, so it has nothing to do with the api
 * client and nothing else in the app has asked for it.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result ?? "")));
    reader.readAsDataURL(file);
  });
}
