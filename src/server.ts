import * as net from "net";
import {
  BodyReader,
  BufferGenerator,
  DirectoryElement,
  DynBuf,
  HTTPReq,
  HTTPRes,
  ServeStaticFilesOptions,
  TCPConn,
} from "./types";
import {
  CRLF,
  DIRECTORIES_INDEX_FILE,
  HTTP_CONTENT_LENGTH_HEADER,
  HTTP_HEADERS_END_CHARS,
  HTTP_HEADERS_END_CHARS_LENGTH,
  HTTP_REQUEST_LINE_SEPARATOR,
  HTTP_TRANSFERT_ENCODING_HEADER,
  HttpStatusCodeReasonMapper,
  MAX_HEADERS_LENGTH,
  NON_ALLOWED_BODY_METHODS_LIST,
  ServerConfig,
  STATIC_FILES_DIRECTOTY_PATH,
} from "./global";
import { HttpError } from "./utils/HttpError";
import { DirectoryListing } from "./utils/DirectoryListing";
import * as fs from "fs/promises";
import { HttpStatusCode } from "./enums";

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
  console.assert(data.length > 0);

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
      bufPush(buffer, data);
      if (data.length === 0 && buffer.length === 0) {
        return;
      }
      if (data.length === 0) {
        throw new HttpError(400, "Unexpected EOF");
      }
      continue;
    }

    console.log(
      "[data_length_received]\n",
      buffer.length,
      buffer.data.toString()
    );

    const reqBody: BodyReader = readerFromReq(conn, buffer, msg);

    const res: HTTPRes = await handleReq(msg, reqBody);

    try {
      await writeHTTPResp(conn, res);
    } finally {
      await res.body.close?.();
    }

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
    .split(CRLF)
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
    return readerFromGenerator(readChunks(conn, buffer));
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

function readerFromGenerator(gen: BufferGenerator): BodyReader {
  return {
    length: -1,
    read: async (): Promise<Buffer> => {
      const { done, value } = await gen.next();

      if (done) {
        console.log("[doneeeeee]");
        return Buffer.from("");
      }

      console.log("[returnbufferF]");
      console.assert(value.length > 0);
      return value;
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

function readerFromStaticFile(fp: fs.FileHandle, size: number): BodyReader {
  let got = 0;
  let readCount = 0;
  return {
    length: size,
    read: async (): Promise<Buffer> => {
      const r: fs.FileReadResult<Buffer> = await fp.read();
      got += r.bytesRead;
      readCount++;

      if (got > size || (got < size && r.bytesRead === 0)) {
        throw new Error("Something went wrong on file reading");
      }
      return r.buffer.subarray(0, r.bytesRead);
    },
    close: async (): Promise<void> => await fp.close(),
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

async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  let response: BodyReader;
  const uri = req.uri.toString("utf8");

  if (uri.startsWith(STATIC_FILES_DIRECTOTY_PATH)) {
    return await serveStaticContent(
      uri.substring(STATIC_FILES_DIRECTOTY_PATH.length)
    );
  } else if (uri === "/echo") {
    response = body;
  } else if (uri === "/sheep") {
    response = readerFromGenerator(countSheep());
  } else {
    response = readerFromMemory(Buffer.from("hello world\n"));
  }

  return {
    code: HttpStatusCode.OK,
    headers: [Buffer.from("server: fdl_server:v0.1")],
    body: response,
  };
}

async function writeHTTPResp(conn: TCPConn, response: HTTPRes): Promise<void> {
  if (response.body.length < 0) {
    response.headers.push(Buffer.from(`Transfer-Encoding: chunked`));
  } else {
    response.headers.push(
      Buffer.from(`Content-Length: ${response.body.length}`)
    );
  }

  await soWrite(conn, encodeHTTPResp(response));

  const crlf = Buffer.from(CRLF);
  for (let last = false; !last; ) {
    let data = await response.body.read();
    last = data.length === 0;

    if (response.body.length < 0) {
      data = Buffer.concat([
        Buffer.from(data.length.toString(16)),
        crlf,
        data,
        crlf,
      ]);
    }

    if (data.length) {
      await soWrite(conn, data);
    }
  }
}

function encodeHTTPResp(response: HTTPRes): Buffer {
  const responseLine = `HTTP/1.1 ${response.code} ${
    HttpStatusCodeReasonMapper[response.code]
  }${CRLF}`;

  const headers = response.headers.map((header) =>
    Buffer.concat([header, Buffer.from(CRLF)])
  );

  const responseBuffer: Buffer[] = [
    Buffer.from(responseLine),
    ...headers,
    Buffer.from(CRLF),
  ];

  return Buffer.concat(responseBuffer);
}

async function* countSheep(): BufferGenerator {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield Buffer.from(`${i}\n`);
  }
}

async function* readChunks(conn: TCPConn, buffer: DynBuf): BufferGenerator {
  console.log("[buffer sting chunks]", buffer.data.toString());
  for (let last = false; !last; ) {
    const idx = buffer.data.subarray(0, buffer.length).indexOf(CRLF);
    if (idx < 0) continue;

    let remain = parseInt(buffer.data.subarray(0, idx).toString());
    console.log("[remain]", remain);
    bufPop(buffer, remain);
    last = remain === 0;

    while (remain > 0) {
      const consume = Math.min(remain, buffer.length);
      const data = buffer.data.subarray(0, consume);
      bufPop(buffer, consume);
      remain -= consume;
      yield data;
    }
    bufPop(buffer, 2);
  }
}

async function serveStaticContent(
  fileName: string,
  options?: ServeStaticFilesOptions
): Promise<HTTPRes> {
  let fp: null | fs.FileHandle = null;
  try {
    const contentPath =
      options && options.isAbsolutePath
        ? fileName
        : `${process.cwd()}/src${STATIC_FILES_DIRECTOTY_PATH}${fileName}`;
    fp = await fs.open(contentPath, "r");
    const stat = await fp.stat();

    if (!stat.isFile()) {
      return serveStaticDir(contentPath);
    }

    const size = stat.size;
    const reader: BodyReader = readerFromStaticFile(fp, size);

    return {
      code: HttpStatusCode.OK,
      body: reader,
      headers: [Buffer.from(`Content-Length: ${size}`)],
    };
  } catch (error) {
    console.log("[error_serving_static_file_file_not_found]", error);
    return responseWithError(HttpStatusCode.NOT_FOUND);
  } finally {
    fp = null;
  }
}

async function serveStaticDir(dirPath: string): Promise<HTTPRes> {
  try {
    const files = await fs.readdir(dirPath);
    if (files.includes(DIRECTORIES_INDEX_FILE)) {
      return serveStaticContent(`${dirPath}/${DIRECTORIES_INDEX_FILE}`, {
        isAbsolutePath: true,
      });
    }

    const directoryListing: DirectoryElement[] = await Promise.all(
      files.map(async (file) => {
        const stat = await fs.stat(`${dirPath}/${file}`);
        return {
          fileName: file,
          isFile: stat.isFile(),
          size: stat.size,
        };
      })
    );

    const body = readerFromMemory(
      Buffer.from(DirectoryListing(directoryListing))
    );

    return {
      code: HttpStatusCode.OK,
      body,
      headers: [Buffer.from(`Content-Length: ${body.length}`)],
    };
  } catch (error) {
    console.log("[error_serving_static_file_file_not_found]", error);
    return responseWithError(HttpStatusCode.NOT_FOUND);
  }
}

function responseWithError(statusCode: HttpStatusCode): HTTPRes {
  return {
    code: statusCode,
    headers: [],
    body: readerFromMemory(Buffer.from(HttpStatusCodeReasonMapper[statusCode])),
  };
}
