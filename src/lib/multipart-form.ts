export type MultipartFile = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

export type MultipartForm = {
  fields: Map<string, string>;
  files: Map<string, MultipartFile>;
};

export function parseMultipartForm(contentType: string, body: Buffer): MultipartForm {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    throw new Error("Missing multipart boundary.");
  }

  const fields = new Map<string, string>();
  const files = new Map<string, MultipartFile>();
  const boundaryMarker = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(boundaryMarker);

  while (cursor !== -1) {
    cursor += boundaryMarker.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;

    const headers = parseHeaders(body.subarray(cursor, headerEnd).toString("utf8"));
    const disposition = headers.get("content-disposition") ?? "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    if (!name) {
      throw new Error("Multipart part is missing a name.");
    }

    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
    if (nextBoundary === -1) {
      throw new Error("Multipart body is missing a closing boundary.");
    }

    const data = body.subarray(dataStart, nextBoundary);
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (filename !== undefined) {
      files.set(name, {
        filename,
        mimeType: headers.get("content-type") ?? "application/octet-stream",
        data: Buffer.from(data),
      });
    } else {
      fields.set(name, data.toString("utf8"));
    }
    cursor = nextBoundary + 2;
  }

  return { fields, files };
}

function parseHeaders(rawHeaders: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of rawHeaders.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return headers;
}
