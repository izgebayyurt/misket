/**
 * Conversion between Unicode code point offsets (what the database stores)
 * and UTF-16 code unit offsets (what the DOM uses).
 */
export interface OffsetMap {
  /** cpToU16[i] = UTF-16 index of code point i; length = codePointCount + 1. */
  cpToU16: Uint32Array;
}

export function buildOffsetMap(text: string): OffsetMap {
  // Count code points first so the array is allocated once.
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    count++;
  }
  const cpToU16 = new Uint32Array(count + 1);
  let cp = 0;
  for (let i = 0; i < text.length; i++) {
    cpToU16[cp++] = i;
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
  }
  cpToU16[cp] = text.length;
  return { cpToU16 };
}

export function codePointCount(map: OffsetMap): number {
  return map.cpToU16.length - 1;
}

export function cpToUtf16(map: OffsetMap, cp: number): number {
  if (cp < 0 || cp >= map.cpToU16.length)
    throw new RangeError(`code point offset ${cp} out of range`);
  return map.cpToU16[cp]!;
}

/** Binary search; a UTF-16 index inside a surrogate pair is rounded down to the pair start. */
export function utf16ToCp(map: OffsetMap, u16: number): number {
  const arr = map.cpToU16;
  if (u16 < 0 || u16 > arr[arr.length - 1]!)
    throw new RangeError(`UTF-16 offset ${u16} out of range`);
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid]! <= u16) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
