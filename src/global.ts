import { HttpMethods, HttpStatusCode } from "./enums";
import { Server } from "./types";

export const ServerConfig: Server = {
  host: "127.0.0.1",
  port: 3000,
};

//headers limit set to 8KB as Apache servers
export const MAX_HEADERS_LENGTH = 1024 * 8;

export const CRLF = "\r\n";
export const HTTP_HEADERS_END_CHARS = `${CRLF}${CRLF}`;
export const HTTP_REQUEST_LINE_SEPARATOR = " ";
export const HTTP_HEADERS_END_CHARS_LENGTH = HTTP_HEADERS_END_CHARS.length;

export const HTTP_CONTENT_LENGTH_HEADER = "Content-Length";
export const HTTP_TRANSFERT_ENCODING_HEADER = "Transfer-Encoding";
// 4\r\nHTTP\r\n5\r\nserve\r\n0\r\n\r\n

export const NON_ALLOWED_BODY_METHODS_LIST = [
  HttpMethods.GET,
  HttpMethods.HEAD,
] as string[];

export const HttpStatusCodeReasonMapper: Record<HttpStatusCode, string> = {
  [HttpStatusCode.OK]: "OK",
  [HttpStatusCode.BAD_REQUEST]: "Bad Request",
  [HttpStatusCode.SERVER_ERROR]: "Internal Server Error",
  [HttpStatusCode.NOT_IMPLEMENTED]: "Not Implemented",
  [HttpStatusCode.NOT_FOUND]: "Not Found",
};

export const STATIC_FILES_DIRECTOTY_PATH = "/files/";

export const DIRECTORIES_INDEX_FILE = "index.html";
