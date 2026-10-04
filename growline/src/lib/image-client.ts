async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not read that photo"));
    i.src = url;
  });
}

/**
 * Downscales a proof photo, keeping its aspect ratio, to a JPEG data URL bounded at
 * roughly a couple of hundred KB (Section 4.4 — cheap phones, slow data).
 *
 * Drawing through a canvas and re-encoding also DISCARDS EXIF, which matters more
 * here than for size: a camera photo carries GPS coordinates and a timestamp, and
 * this image is about to be sent to the coach's upline. Re-encoding means a proof
 * cannot quietly disclose where the coach lives.
 */
export async function fileToProofDataUrl(file: File, maxEdge = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that photo");
    ctx.drawImage(img, 0, 0, width, height);

    // Step the quality down until it fits, rather than rejecting a big photo and
    // leaving the coach with nothing to send.
    for (const quality of [0.75, 0.6, 0.45, 0.3]) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (out.length <= 900_000) return out;
    }
    throw new Error("That photo is too large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Downscales a picked photo to a square JPEG data URL (~20 KB) on the client,
 * so cheap-phone camera files never travel at full size (Section 4.4).
 */
export async function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that photo");
    const side = Math.min(img.width, img.height);
    ctx.drawImage(
      img,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size
    );
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}
