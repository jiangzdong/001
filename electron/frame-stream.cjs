function boundaryFromContentType(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  return match?.[1] || match?.[2] || "";
}

function createMultipartFrameParser({ boundary, onFrame = () => {}, onMetadata = () => {} }) {
  if (!boundary) throw new Error("帧流响应缺少 multipart boundary");
  const marker = Buffer.from(`--${boundary}`);
  const headerBreak = Buffer.from("\r\n\r\n");
  let buffer = Buffer.alloc(0);
  let finished = false;

  function push(chunk, flush = false) {
    if (finished) return;
    if (chunk?.length) buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length) {
      const markerIndex = buffer.indexOf(marker);
      if (markerIndex < 0) {
        if (flush) buffer = Buffer.alloc(0);
        else if (buffer.length > marker.length) buffer = buffer.subarray(buffer.length - marker.length);
        return;
      }
      if (markerIndex > 0) buffer = buffer.subarray(markerIndex);
      if (buffer.length < marker.length + 2) return;
      if (buffer.subarray(marker.length, marker.length + 2).toString("ascii") === "--") {
        finished = true;
        buffer = Buffer.alloc(0);
        return;
      }
      const headersStart = marker.length + 2;
      const headersEnd = buffer.indexOf(headerBreak, headersStart);
      if (headersEnd < 0) return;
      const headers = Object.fromEntries(buffer.subarray(headersStart, headersEnd).toString("utf8").split("\r\n").map((line) => {
        const separator = line.indexOf(":");
        return separator > 0 ? [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()] : ["", ""];
      }).filter(([key]) => key));
      const length = Number(headers["content-length"]);
      if (!Number.isInteger(length) || length < 0 || length > 8 * 1024 * 1024) throw new Error("帧流分片长度无效");
      const payloadStart = headersEnd + headerBreak.length;
      const payloadEnd = payloadStart + length;
      if (buffer.length < payloadEnd + 2) return;
      const payload = buffer.subarray(payloadStart, payloadEnd);
      const contentType = headers["content-type"] || "application/octet-stream";
      if (contentType.startsWith("image/")) {
        onFrame({
          bytes: new Uint8Array(payload),
          contentType,
          index: Number(headers["x-frame-index"]) || 0,
          timestampMs: Number(headers["x-frame-timestamp-ms"]) || 0,
        });
      } else if (contentType === "application/json") {
        let metadata = {};
        try { metadata = JSON.parse(payload.toString("utf8")); } catch {}
        onMetadata(metadata);
      }
      buffer = buffer.subarray(payloadEnd + 2);
    }
  }

  return { push, isFinished: () => finished };
}

async function readMultipartFrameStream(response, callbacks = {}) {
  const boundary = boundaryFromContentType(response?.headers?.get?.("content-type"));
  if (!boundary || !response?.body) throw new Error("本机 GPU 服务未返回可读取的帧流");
  const parser = createMultipartFrameParser({ boundary, ...callbacks });
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    parser.push(value, done);
    if (done) break;
  }
  return { finished: parser.isFinished() };
}

module.exports = { boundaryFromContentType, createMultipartFrameParser, readMultipartFrameStream };
