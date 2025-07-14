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
