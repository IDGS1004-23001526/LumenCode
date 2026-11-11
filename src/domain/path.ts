export const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** Resuelve "." y ".." (Windows y POSIX). */
export function normalizePath(p: string): string {
  const win = /^[a-zA-Z]:/.test(p);
  const out: string[] = [];
  for (const part of p.split(/[\\/]+/).filter(Boolean)) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length > (win ? 1 : 0)) out.pop();
      continue;
    }
    out.push(part);
  }
  if (win) return out.length === 1 ? `${out[0]}\\` : out.join("\\");
  return "/" + out.join("/");
}

/** Devuelve la carpeta contenedora de una ruta */
export function parentDirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

/** Verifica que el nombre de archivo tenga nombre y extensión */
export function hasFileExtension(name: string): boolean {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot > 0 && dot < trimmed.length -1;
}


export const isAbsolutePath = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/");

export const isValidName = (name: string): boolean =>
  name.trim().length > 0 && !/[<>:"/\\|?*]/.test(name);

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "pdf", "zip", "rar", "7z",
  "gz", "exe", "dll", "so", "dylib", "bin", "class", "pyc", "woff", "woff2", "ttf", "otf", 
  "mp3", "mp4",
]);

/** "Archivo válido" para abrir en el editor. */
export const isTextFile = (path: string): boolean =>
  !BINARY_EXT.has(path.split(".").pop()?.toLowerCase() ?? "");