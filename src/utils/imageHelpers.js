/**
 * Image/Video helper utilities - parse dimensions from file headers without full decode
 */

const VIDEO_EXTENSIONS = ['.mp4', '.webm'];
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp']);

export function isVideoFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function isImageFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return IMAGE_EXTENSIONS.has(lower);
}

/**
 * Parse image/video dimensions from raw buffer header bytes (no full decode needed).
 * Supports: JPEG, PNG, GIF, WebP, MP4 (via tkhd atom)
 */
export function getImageDimensions(buffer) {
  const bytes = new Uint8Array(buffer);

  // JPEG (FF D8)
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];
      if ((marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + length;
      if (length < 2 || offset >= bytes.length) break;
    }
  }

  // PNG (89 50 4E 47)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width, height };
  }

  // GIF (47 49 46 38)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) return { width, height };
  }

  // WebP (52 49 46 46 = "RIFF", 4-byte size, 57 45 42 50 = "WEBP" at bytes 8-11)
  // Sub-format FourCC at bytes 12-15: "VP8 " (lossy), "VP8L" (lossless), "VP8X" (extended)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    let width = 0, height = 0;
    if (fourCC === 'VP8 ' && bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A) {
      // VP8 lossy: 14-bit little-endian dimensions at 26..29, top 2 bits unused
      width = bytes[26] | ((bytes[27] & 0x3F) << 8);
      height = bytes[28] | ((bytes[29] & 0x3F) << 8);
    } else if (fourCC === 'VP8L' && bytes[20] === 0x2F) {
      // VP8L lossless: signature 0x2F at byte 20, 14-bit packed dimensions at 21-24
      // width-1 = (b22 & 0x3F)<<8 | b21 ; height-1 = (b24 & 0x0F)<<10 | b23<<2 | (b22 & 0xC0)>>6
      const b21 = bytes[21], b22 = bytes[22], b23 = bytes[23], b24 = bytes[24];
      width = 1 + (((b22 & 0x3F) << 8) | b21);
      height = 1 + (((b24 & 0x0F) << 10) | (b23 << 2) | ((b22 & 0xC0) >> 6));
    } else if (fourCC === 'VP8X') {
      // VP8X extended: 24-bit canvas size minus 1 at 24..29
      width = 1 + ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xFFFFFF);
      height = 1 + ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xFFFFFF);
    }
    if (width > 0 && height > 0) return { width, height };
  }

  // MP4: look for ftyp box at offset 4, then find moov/trak/tkhd
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    for (let i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0x74 && bytes[i+1] === 0x6B && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
        const version = bytes[i + 4];
        let widthOffset, heightOffset;
        if (version === 0) {
          widthOffset = i + 84;
          heightOffset = i + 88;
        } else {
          widthOffset = i + 92;
          heightOffset = i + 96;
        }
        if (widthOffset + 4 <= bytes.length && heightOffset + 4 <= bytes.length) {
          const width = (bytes[widthOffset] << 8) | bytes[widthOffset + 1];
          const height = (bytes[heightOffset] << 8) | bytes[heightOffset + 1];
          if (width > 0 && height > 0) return { width, height };
        }
      }
    }
  }

  return null;
}
