export async function preparePhoto(file: File): Promise<string> {
  if (file.size > 25_000_000)
    throw new Error("Choose a photo smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("Could not open this photo. Try a JPEG or PNG.");
    });
    const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Photo processing is unavailable on this browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.split(",")[1].length <= 3_000_000) return data;
    }
    throw new Error("Photo is too large. Crop it and try again.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
