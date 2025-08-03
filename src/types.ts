import * as net from "net";

export type TCPConn = {
  socket: net.Socket;
  reader: null | {
    resolve: (buffer: Buffer) => void;
    reject: (reason: Error) => void;
  };
  error: null | Error;
  ended: boolean;
};

export type DynBuf = {
  data: Buffer;
  length: number;
};

export type Server = {
  host: string;
  port: number;
};

export type HTTPReq = {
  method: string;
  uri: Buffer;
  version: string;
  headers: Buffer[];
};

export type BodyReader = {
  length: number;
  read: () => Promise<Buffer>;
  close?: () => Promise<void>;
};

export type HTTPRes = {
  code: number;
  headers: Buffer[];
  body: BodyReader;
};

export type BufferGenerator = AsyncGenerator<Buffer, void, void>;
