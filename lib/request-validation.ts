export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function validateImage(body: unknown): {
  imageBase64: string;
  mimeType: string;
} {
  if (!body || typeof body !== "object")
    throw new RequestError("Upload a photo first.");
  const { imageBase64, mimeType } = body as Record<string, unknown>;
  if (typeof imageBase64 !== "string" || !imageBase64.length)
    throw new RequestError("Upload a photo first.");
  if (imageBase64.length > 3_000_000)
    throw new RequestError("Photo is too large. Try a smaller image.", 413);
  if (imageBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64))
    throw new RequestError("Invalid image encoding.");
  if (
    mimeType !== "image/jpeg" &&
    mimeType !== "image/png" &&
    mimeType !== "image/webp"
  )
    throw new RequestError("Use a JPEG, PNG, or WebP photo.");
  const bytes = Buffer.from(imageBase64, "base64");
  const valid =
    mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid)
    throw new RequestError("Photo contents do not match the file type.");
  return { imageBase64, mimeType };
}

export async function readJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new RequestError("Send JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestError("Request is too large.", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("Invalid JSON.");
  } finally {
    reader.releaseLock();
  }
}
