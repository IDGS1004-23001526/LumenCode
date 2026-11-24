export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export function joinPath(dir: string, name: string): string {
  const isWin = /^[a-zA-Z]:/.test(dir) || dir.includes("\\");
  const sep = isWin ? "\\" : "/";
  const normDir = isWin ? dir.replace(/\//g, "\\") : dir.replace(/\\/g, "/");
  const normName = (isWin ? name.replace(/\//g, "\\") : name.replace(/\\/g, "/")).replace(/^[\\/]+/, "");
  if (!normName) return normDir;
  return normDir.endsWith(sep) ? normDir + normName : normDir + sep + normName;
}

/** Resuelve "." y ".." (Windows, UNC y POSIX). */
export function normalizePath(p: string): string {
  const isUnc = /^[\\/]{2}[^\\/]/.test(p);
  const win = /^[a-zA-Z]:/.test(p);
  // En UNC la raíz son dos segmentos (`\\server\share`) y nunca deben eliminarse.
  const floor = win ? 1 : isUnc ? 2 : 0;
  const out: string[] = [];
  for (const part of p.split(/[\\/]+/).filter(Boolean)) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length > floor) out.pop();
      continue;
    }
    out.push(part);
  }
  if (isUnc) {
    if (out.length === 0) return "\\\\";
    return `\\\\${out.join("\\")}`;
  }
  if (win) {
    if (out.length > 0) out[0] = out[0].toUpperCase();
    return out.length === 1 ? `${out[0]}\\` : out.join("\\");
  }
  return "/" + out.join("/");
}

/** Compara dos rutas tolerando diferencias de separadores (`/` vs `\`) y mayúsculas en Windows. */
export function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (na === nb) return true;
  if (/^[A-Z]:\\/.test(na) && /^[A-Z]:\\/.test(nb)) {
    return na.toLowerCase() === nb.toLowerCase();
  }
  if (na.startsWith("\\\\") && nb.startsWith("\\\\")) {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return false;
}

/** Devuelve la carpeta contenedora de una ruta (preservando raíces `/` y `C:\`). */
export function parentDirOf(path: string): string {
  if (/^[a-zA-Z]:[\\/]*$/.test(path)) return `${path.slice(0, 2)}\\`;
  if (/^\/+$/.test(path)) return "/";
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (idx < 0) return trimmed;
  if (idx === 0) return "/";
  if (idx === 2 && /^[a-zA-Z]:/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`;
  return trimmed.slice(0, idx);
}

/** Devuelve la extensión en minúsculas de un archivo, o `""` si no tiene extensión. */
export function fileExtensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Verifica que el nombre de archivo tenga nombre y extensión */
export function hasFileExtension(name: string): boolean {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 && dot < trimmed.length -1;
}


export const isAbsolutePath = (p: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p) || p.startsWith("/");

export const isValidName = (name: string): boolean =>
  name.trim().length > 0 && !/[<>:"/\\|?*]/.test(name);

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "pdf", "zip", "rar", "7z",
  "gz", "exe", "dll", "so", "dylib", "bin", "class", "pyc", "woff", "woff2", "ttf", "otf", 
  "mp3", "mp4",
]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

export const isImageFile = (path: string): boolean => {
  const ext = fileExtensionOf(path);
  return Boolean(ext && Object.prototype.hasOwnProperty.call(IMAGE_MIME, ext));
};

export const imageMimeFor = (path: string): string => {
  const ext = fileExtensionOf(path);
  return (ext && Object.prototype.hasOwnProperty.call(IMAGE_MIME, ext) ? IMAGE_MIME[ext] : undefined) ?? "application/octet-stream";
};

/** "Archivo válido" para abrir en el editor. */
export const isTextFile = (path: string): boolean => {
  const ext = fileExtensionOf(path);
  return !ext || !BINARY_EXT.has(ext);
};