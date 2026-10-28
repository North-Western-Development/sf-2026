package click.subspace.bot;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/** A tiny WebSocket server (RFC 6455, text frames only) that speaks the Subspace gateway protocol. */
final class FakeGateway implements AutoCloseable {
    final ServerSocket server;
    final List<Conn> conns = new CopyOnWriteArrayList<>();
    final List<String> identifyTokens = new CopyOnWriteArrayList<>();
    final AtomicInteger heartbeats = new AtomicInteger();
    final String goodToken;
    final long heartbeatInterval;

    FakeGateway(String goodToken, long heartbeatInterval) throws IOException {
        this.goodToken = goodToken;
        this.heartbeatInterval = heartbeatInterval;
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        Thread t = new Thread(this::acceptLoop, "fake-gateway");
        t.setDaemon(true);
        t.start();
    }

    String url() {
        return "ws://127.0.0.1:" + server.getLocalPort() + "/gateway";
    }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket s = server.accept();
                Conn c = new Conn(s);
                conns.add(c);
                Thread t = new Thread(c::run, "fake-gateway-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                return;
            }
        }
    }

    @Override
    public void close() throws IOException {
        server.close();
        for (Conn c : conns) c.socket.close();
    }

    final class Conn {
        final Socket socket;
        OutputStream out;
        volatile boolean open = true;
        volatile int clientCloseCode = -1;

        Conn(Socket socket) {
            this.socket = socket;
        }

        void run() {
            try {
                InputStream in = socket.getInputStream();
                out = socket.getOutputStream();
                String key = null;
                String line;
                while (!(line = readLine(in)).isEmpty()) {
                    int colon = line.indexOf(':');
                    if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("Sec-WebSocket-Key")) key = line.substring(colon + 1).trim();
                }
                String accept = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
                out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                out.flush();
                sendText("{\"op\":10,\"d\":{\"heartbeat_interval\":" + heartbeatInterval + "}}");
                ByteArrayOutputStream message = new ByteArrayOutputStream();
                while (open) {
                    int b0 = in.read();
                    if (b0 < 0) break;
                    int b1 = in.read();
                    int opcode = b0 & 0x0f;
                    boolean fin = (b0 & 0x80) != 0;
                    long len = b1 & 0x7f;
                    if (len == 126) len = (in.read() << 8) | in.read();
                    else if (len == 127) {
                        len = 0;
                        for (int i = 0; i < 8; i++) len = (len << 8) | in.read();
                    }
                    byte[] mask = (b1 & 0x80) != 0 ? in.readNBytes(4) : null;
                    byte[] payload = in.readNBytes((int) len);
                    if (mask != null) for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
                    if (opcode == 8) {
                        clientCloseCode = payload.length >= 2 ? ((payload[0] & 0xff) << 8) | (payload[1] & 0xff) : 1005;
                        closeWith(clientCloseCode == 1005 ? 1000 : clientCloseCode, "");
                        break;
                    }
                    if (opcode == 9) {
                        frame(0xA, payload);
                        continue;
                    }
                    if (opcode == 1 || opcode == 0) {
                        message.write(payload);
                        if (fin) {
                            onText(message.toString(StandardCharsets.UTF_8));
                            message.reset();
                        }
                    }
                }
            } catch (Exception e) {
                // connection gone
            } finally {
                open = false;
                try {
                    socket.close();
                } catch (IOException ignored) {
                }
            }
        }

        private void onText(String text) throws IOException {
            Map<String, Object> msg = Json.parseObject(text);
            long op = Json.num(msg, "op", -1);
            if (op == 1) {
                heartbeats.incrementAndGet();
                sendText("{\"op\":11}");
            } else if (op == 2) {
                String token = Json.str(Json.obj(msg, "d"), "token");
                identifyTokens.add(token);
                if (!("Bot " + goodToken).equals(token)) {
                    closeWith(4003, "Invalid or expired authentication ticket");
                    open = false;
                    return;
                }
                sendText("{\"op\":0,\"t\":\"READY\",\"d\":{\"transmitter\":{\"id\":\"10\",\"username\":\"dice\"},\"session_id\":\"s\"}}");
            }
        }

        synchronized void sendText(String text) throws IOException {
            frame(1, text.getBytes(StandardCharsets.UTF_8));
        }

        synchronized void closeWith(int code, String reason) throws IOException {
            byte[] r = reason.getBytes(StandardCharsets.UTF_8);
            byte[] p = new byte[2 + r.length];
            p[0] = (byte) (code >> 8);
            p[1] = (byte) code;
            System.arraycopy(r, 0, p, 2, r.length);
            frame(8, p);
        }

        /** Drop the connection as a server shutting down would. */
        void serverClose(int code) throws IOException {
            closeWith(code, "going away");
            open = false;
            socket.close();
        }

        private synchronized void frame(int opcode, byte[] payload) throws IOException {
            ByteArrayOutputStream f = new ByteArrayOutputStream();
            f.write(0x80 | opcode);
            if (payload.length < 126) f.write(payload.length);
            else if (payload.length < 65536) {
                f.write(126);
                f.write(payload.length >> 8);
                f.write(payload.length & 0xff);
            } else {
                f.write(127);
                for (int i = 7; i >= 0; i--) f.write((int) ((long) payload.length >> (8 * i)) & 0xff);
            }
            f.write(payload);
            out.write(f.toByteArray());
            out.flush();
        }
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.append((char) c);
        }
        return b.toString();
    }
}
