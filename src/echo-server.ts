import * as net from "net";

const server = net.createServer({ pauseOnConnect: true });
server.listen({ port: 3000, host: "127.0.0.1" });

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
  while (true) {
    const data = await soRead(conn);
    if (data.length === 0) {
      console.log("[closing_connection]");
      break;
    }

    console.log("[received_data]", data);

    await soWrite(conn, data);
  }
}
