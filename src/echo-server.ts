import * as net from "net";

const server = net.createServer();
server.listen({ port: 3000, host: "127.0.0.1" });

server.on("connection", newConn);
server.on("error", (error: Error) => {
  throw error;
});

function newConn(socket: net.Socket): void {
  console.log("[new connection]", socket.remoteAddress, socket.remotePort);

  socket.on("end", () => {
    console.log("[EOF]");
  });

  socket.on("data", (data: Buffer) => {
    console.log("[data_received]", data);
    socket.write(data);

    if (data.includes("q")) {
      console.log("[closing_connection]");
      socket.end();
    }
  });
}
