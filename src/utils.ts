export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export const deepClone: <T>(x: T) => T = globalThis.structuredClone
  ? globalThis.structuredClone
  : (obj) => JSON.parse(JSON.stringify(obj));
