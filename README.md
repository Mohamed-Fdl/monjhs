# monjhs

My Own NodeJs HTTP Server

## Create a TCP echo server

### TCP PROTOCOL

Our echo server does 03 things

- read and parse buffer sent by client and checks if there is message in it
- handle the message
- reply back to the client

#### Protocol implemented

- Client send data like: DATA1\n
- Server reply like: Echo: DATA1\n
- If client send quit\n
- Server reply with Bye.\n and close the connection

### Test the echo tcp server

Test the echo server

- launch the server: npm run echo.tcp
- launch a tcp client:
