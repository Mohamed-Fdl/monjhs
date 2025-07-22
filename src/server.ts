import * as net from "net";
import { BodyReader, DynBuf, HTTPReq, HTTPRes, TCPConn } from "./types";
import {
  HTTP_CONTENT_LENGTH_HEADER,
  HTTP_HEADER_LINE_END_CHARS,
  HTTP_HEADERS_END_CHARS,
  HTTP_HEADERS_END_CHARS_LENGTH,
  HTTP_REQUEST_LINE_SEPARATOR,
  HTTP_TRANSFERT_ENCODING_HEADER,
  HttpStatusCodeReasonMapper,
  MAX_HEADERS_LENGTH,
  NON_ALLOWED_BODY_METHODS_LIST,
  ServerConfig,
} from "./global";
import { HttpError } from "./utils/HttpError";

const server = net.createServer({ pauseOnConnect: true, noDelay: true });
server.listen(ServerConfig);

server.on("connection", newConn);

server.on("error", (error: Error) => {
  throw error;
});

async function newConn(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);
  console.log("[new connection]", socket.remoteAddress, socket.remotePort);
  try {
    await serveClient(conn);
  } catch (error) {
    console.error("[error_while_serving_client]", error);
    if (error instanceof HttpError) {
      const errorRes: HTTPRes = {
        code: error.statusCode,
        headers: [],
        body: readerFromMemory(Buffer.from(error.message + "\n")),
      };
      await writeHTTPResp(conn, errorRes);
    }
  } finally {
    socket.destroy();
  }
}

function soInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket,
    reader: null,
    ended: false,
    error: null,
  };

  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);

    conn.socket.pause();
    conn.reader!.resolve(data);

    conn.reader = null;
  });

  socket.on("end", () => {
    conn.ended = true;
    if (conn.reader) {
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });

  socket.on("error", (error: Error) => {
    conn.error = error;
    if (conn.reader) {
      conn.reader.reject(error);
      conn.reader = null;
    }
  });

  return conn;
}

function soRead(conn: TCPConn): Promise<Buffer> {
  console.assert(!conn.reader);
  return new Promise((resolve, reject) => {
    if (conn.error) {
      reject(conn.error);
      return;
    }

    if (conn.ended) {
      resolve(Buffer.from(""));
      return;
    }

    conn.reader = { resolve, reject };
    conn.socket.resume();
  });
}

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.log(data.length > 0);

  return new Promise((resolve, reject) => {
    if (conn.error) {
      reject(conn.error);
      return;
    }

    conn.socket.write(data, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

async function serveClient(conn: TCPConn): Promise<void> {
  const buffer: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    const msg = cutMessages(buffer);
    if (!msg) {
      const data = await soRead(conn);
      console.log("[data_length_received]\n", data.length, data.toString());
      bufPush(buffer, data);
      if (data.length === 0 && buffer.length === 0) {
        return;
      }
      if (data.length === 0) {
        throw new HttpError(400, "Unexpected EOF");
      }
      continue;
    }

    const reqBody: BodyReader = readerFromReq(conn, buffer, msg);

    const res: HTTPRes = handleReq(msg, reqBody);

    await writeHTTPResp(conn, res);

    if (msg.version === "1.0") return;

    while ((await reqBody.read()).length > 0) {}
  }
}

function bufPush(buffer: DynBuf, data: Buffer): void {
  const newLen = buffer.length + data.length;

  if (buffer.data.length < newLen) {
    let cap = Math.max(buffer.data.length, 32);

    while (cap < newLen) {
      cap *= 2;
    }

    const grown = Buffer.alloc(cap);
    buffer.data.copy(grown, 0, 0);
    buffer.data = grown;
  }

  data.copy(buffer.data, buffer.length, 0);
  buffer.length = newLen;

  return;
}

function bufPop(buffer: DynBuf, length: number): void {
  buffer.data.copyWithin(0, length, buffer.length);
  buffer.length -= length;
}

function cutMessages(buffer: DynBuf): null | HTTPReq {
  const idx = buffer.data
    .subarray(0, buffer.length)
    .indexOf(HTTP_HEADERS_END_CHARS);

  if (idx < 0) {
    if (buffer.length >= MAX_HEADERS_LENGTH) {
      throw new HttpError(413, "Headers are too large");
    }
    return null;
  }

  const msg = parseHTTPReq(
    buffer.data.subarray(0, idx + HTTP_HEADERS_END_CHARS_LENGTH)
  );

  bufPop(buffer, idx + HTTP_HEADERS_END_CHARS_LENGTH);

  return msg;
}

function parseHTTPReq(buffer: Buffer): HTTPReq {
  const lines: Buffer[] = splitLines(buffer);

  const [method, uri, version] = parseRequestLine(lines[0]);

  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const header = lines[i];
    // here we have to loop over the headers and check them according to the RFCs
    headers.push(header);
  }

  return {
    method,
    uri: Buffer.from(uri),
    version,
    headers,
  };
}

function splitLines(buffer: Buffer): Buffer[] {
  return buffer
    .toString()
    .replace(HTTP_HEADERS_END_CHARS, "")
    .split(HTTP_HEADER_LINE_END_CHARS)
    .map((line) => Buffer.from(line));
}

function parseRequestLine(buffer: Buffer): [string, string, string] {
  let requestLine = buffer.toString();

  const method = requestLine.slice(
    0,
    requestLine.indexOf(HTTP_REQUEST_LINE_SEPARATOR)
  );
  requestLine = requestLine.replace(
    `${method}${HTTP_REQUEST_LINE_SEPARATOR}`,
    ``
  );

  const uri = requestLine.slice(
    0,
    requestLine.indexOf(HTTP_REQUEST_LINE_SEPARATOR)
  );
  requestLine = requestLine.replace(`${uri}${HTTP_REQUEST_LINE_SEPARATOR}`, ``);

  const version = requestLine.replace("HTTP/", "");

  return [method, uri, version];
}

function readerFromReq(
  conn: TCPConn,
  buffer: DynBuf,
  req: HTTPReq
): BodyReader {
  const bodyAllowed = !NON_ALLOWED_BODY_METHODS_LIST.includes(req.method);

  let bodyLength = -1;

  const contentLength = fieldGet(req.headers, HTTP_CONTENT_LENGTH_HEADER);
  if (contentLength) {
    bodyLength = parseInt(contentLength.toString("latin1"));
    if (isNaN(bodyLength)) throw new HttpError(400, "Invalid content length");
  }

  const chunked =
    fieldGet(req.headers, HTTP_TRANSFERT_ENCODING_HEADER)?.equals(
      Buffer.from("chunked")
    ) || false;

  if (!bodyAllowed && (bodyLength > 0 || chunked)) {
    throw new HttpError(400, "HTTP Body not allowed");
  }

  if (!bodyAllowed) {
    bodyLength = 0;
  }

  if (bodyLength >= 0) {
    return readerFromConnLength(conn, buffer, bodyLength);
  } else if (chunked) {
    throw new HttpError(501, "Transfert encoding:chunked not supported yet");
  } else {
    throw new HttpError(501, "TODO");
  }
}

function readerFromConnLength(
  conn: TCPConn,
  buffer: DynBuf,
  remain: number
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain === 0) {
        return Buffer.from("");
      }

      if (buffer.length === 0) {
        const data = await soRead(conn);
        bufPush(buffer, data);
        if (data.length === 0) {
          throw new HttpError(400, "Unexpected EOF");
        }
      }

      const consume = Math.min(buffer.length, remain);

      remain -= consume;
      const data = Buffer.from(buffer.data.subarray(0, consume));
      bufPop(buffer, consume);
      return data;
    },
  };
}

function readerFromMemory(buffer: Buffer): BodyReader {
  let alreadyRead = false;
  return {
    length: buffer.length,
    read: async (): Promise<Buffer> => {
      if (alreadyRead) {
        return Buffer.from("");
      }
      alreadyRead = true;
      return buffer;
    },
  };
}

function fieldGet(headers: Buffer[], key: string): null | Buffer {
  for (let i = 0; i < headers.length; i++) {
    const headerString = headers[i].toString().toLocaleLowerCase();
    if (headerString.includes(key.toLocaleLowerCase())) {
      return Buffer.from(headerString.split(":")[1].trim());
    }
  }
  return null;
}

function handleReq(req: HTTPReq, body: BodyReader): HTTPRes {
  let response: BodyReader;

  switch (req.uri.toString("latin1")) {
    case "/echo":
      response = body;
      break;

    default:
      response = readerFromMemory(Buffer.from("hello world\n"));
      break;
  }

  return {
    code: 200,
    headers: [Buffer.from("server: fdl_server,v0.1")],
    body: response,
  };
}

async function writeHTTPResp(conn: TCPConn, response: HTTPRes): Promise<void> {
  if (response.body.length < 0) {
    throw new HttpError(501, "Transfert Encoding not implemented yet");
  }

  console.assert(!fieldGet(response.headers, HTTP_CONTENT_LENGTH_HEADER));

  response.headers.push(Buffer.from(`Content-Length: ${response.body.length}`));

  await soWrite(conn, encodeHTTPResp(response));

  while (true) {
    const data = await response.body.read();
    if (data.length === 0) break;

    await soWrite(conn, data);
  }
}

function encodeHTTPResp(response: HTTPRes): Buffer {
  const responseLine = `HTTP/1.1 ${response.code} ${
    HttpStatusCodeReasonMapper[response.code]
  }${HTTP_HEADER_LINE_END_CHARS}`;

  const headers = response.headers.map((header) =>
    Buffer.concat([header, Buffer.from(HTTP_HEADER_LINE_END_CHARS)])
  );

  const responseBuffer: Buffer[] = [
    Buffer.from(responseLine),
    ...headers,
    Buffer.from(HTTP_HEADER_LINE_END_CHARS),
  ];

  return Buffer.concat(responseBuffer);
}
