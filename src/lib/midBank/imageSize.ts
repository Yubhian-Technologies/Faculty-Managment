// Width and height of a PNG or JPEG from its bytes - enough to enforce the
// question-image limits without an image library. Null when unreadable.

export function imageKind(buf: Uint8Array): "png" | "jpg" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

export function imageSize(buf: Uint8Array): { width: number; height: number } | null {
  const kind = imageKind(buf);
  const u16 = (i: number) => (buf[i] << 8) | buf[i + 1];
  const u32 = (i: number) => ((buf[i] << 24) >>> 0) + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3];
  if (kind === "png") {
    if (buf.length < 24) return null;
    return { width: u32(16), height: u32(20) }; // IHDR
  }
  if (kind === "jpg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16(i + 5), width: u16(i + 7) };
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}
