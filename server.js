const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const PORT = parseInt(process.env.PORT || '3000', 10);

// In-memory session state (survives page refreshes, resets on server restart)
let sessionState = {
  videoUrl: '',
  isPlaying: false,
  currentTime: 0,
  timestamp: Date.now(),
};

// Connected users: socketId -> { username, role, socketId }
const connectedUsers = new Map();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e6,
  });

  io.on('connection', (socket) => {
    // Client authenticates after connecting
    socket.on('auth', ({ username, role }) => {
      connectedUsers.set(socket.id, { username, role, socketId: socket.id });
      socket.join('main');

      // Send current session state to the newly joined client
      socket.emit('session:state', {
        ...sessionState,
        users: Array.from(connectedUsers.values()),
      });

      // Broadcast updated user list to everyone
      io.to('main').emit('room:users', Array.from(connectedUsers.values()));

      // Notify existing peers for WebRTC setup
      if (role === 'user') {
        connectedUsers.forEach((u, sid) => {
          if (u.role === 'admin' && sid !== socket.id) {
            io.to(sid).emit('webrtc:peer-joined', { peerId: socket.id, username });
          }
        });
      } else if (role === 'admin') {
        connectedUsers.forEach((u, sid) => {
          if (u.role === 'user' && sid !== socket.id) {
            socket.emit('webrtc:peer-joined', { peerId: sid, username: u.username });
          }
        });
      }
    });

    // ── Video control events (emitted by admin, broadcast to users) ──────────

    socket.on('video:play', ({ currentTime }) => {
      sessionState = { ...sessionState, isPlaying: true, currentTime, timestamp: Date.now() };
      socket.to('main').emit('video:play', { currentTime, timestamp: sessionState.timestamp });
    });

    socket.on('video:pause', ({ currentTime }) => {
      sessionState = { ...sessionState, isPlaying: false, currentTime, timestamp: Date.now() };
      socket.to('main').emit('video:pause', { currentTime, timestamp: sessionState.timestamp });
    });

    socket.on('video:seek', ({ currentTime }) => {
      sessionState = { ...sessionState, currentTime, timestamp: Date.now() };
      socket.to('main').emit('video:seek', { currentTime, timestamp: sessionState.timestamp });
    });

    // Admin periodic heartbeat so new joiners get accurate time
    socket.on('video:heartbeat', ({ currentTime }) => {
      sessionState = { ...sessionState, currentTime, timestamp: Date.now() };
    });

    // Admin changes the active video URL
    socket.on('video:url-change', ({ url }) => {
      sessionState = { videoUrl: url, isPlaying: false, currentTime: 0, timestamp: Date.now() };
      io.to('main').emit('session:state', {
        ...sessionState,
        users: Array.from(connectedUsers.values()),
      });
    });

    // ── WebRTC signaling ─────────────────────────────────────────────────────

    socket.on('webrtc:offer', ({ targetId, offer }) => {
      io.to(targetId).emit('webrtc:offer', { fromId: socket.id, offer });
    });

    socket.on('webrtc:answer', ({ targetId, answer }) => {
      io.to(targetId).emit('webrtc:answer', { fromId: socket.id, answer });
    });

    socket.on('webrtc:ice', ({ targetId, candidate }) => {
      io.to(targetId).emit('webrtc:ice', { fromId: socket.id, candidate });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.id);
      io.to('main').emit('room:users', Array.from(connectedUsers.values()));
      io.to('main').emit('webrtc:peer-left', { peerId: socket.id });
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`\n  ✦ CinemaSync ready → http://localhost:${PORT}\n`);
  });
});
