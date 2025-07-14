import * as net from "net";

const PORT = 3000;
const server = net.createServer({ pauseOnConnect: true });
server.listen({ port: PORT, host: "127.0.0.1" });

server.on("connection", newConn);
server.on("error", (error: Error) => {
  throw error;
});

async function newConn(socket: net.Socket): Promise<void> {
  console.log("[new connection]", socket.remoteAddress, socket.remotePort);

  try {
    await serveClient(socket);
  } catch (error) {
    console.error("[error_while_serving_client]", error);
  } finally {
    socket.destroy();
  }
}

type TCPConn = {
  socket: net.Socket;
  reader: null | {
    resolve: (buffer: Buffer) => void;
    reject: (reason: Error) => void;
  };
  error: null | Error;
  ended: boolean;
};

type DynBuf = {
  data: Buffer;
  length: number;
};

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

async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);
  const buffer: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    const msg = cutMessages(buffer);
    if (!msg) {
      const data = await soRead(conn);
      console.log("[data_length_received]", data.length, data.toString());
      if (data.length === 0) {
        break;
      }
      bufPush(buffer, data);
      continue;
    }

    console.log("[received_data]:", msg.toString());

    if (msg.equals(Buffer.from("quit"))) {
      console.log("[received_closing_message]", msg.toString());
      await soWrite(conn, Buffer.from("Bye.\n"));
      socket.destroy();
      return;
    }

    await soWrite(conn, Buffer.concat([Buffer.from("Echo: "), msg]));
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

// remove data from the top
function bufPop(buffer: DynBuf, length: number): void {
  buffer.data.copyWithin(0, length, buffer.length);
  buffer.length -= length;
}

function cutMessages(buffer: DynBuf): null | Buffer {
  const idx = buffer.data.subarray(0, buffer.length).indexOf("\n");

  if (idx < 0) {
    return null;
  }

  const msg = Buffer.from(buffer.data.subarray(0, idx + 1));
  bufPop(buffer, idx + 1);
  return msg;
}
