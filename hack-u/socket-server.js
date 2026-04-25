const { createServer } = require("node:http");
const { Server } = require("socket.io");

const PORT = Number(process.env.SOCKET_PORT || 3001);

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const playersBySocket = new Map();
const roomChats = new Map();
const roomSeenUsers = new Map();
const CHAT_RANGE = 170;

const normalizeKeyword = (keyword) => String(keyword || "").trim().replace(/\s+/g, " ").toLowerCase();
const buildRoomKey = (mode, keyword) => `${mode}:${normalizeKeyword(keyword)}`;

const emitRoomState = async (roomKey) => {
  if (!roomKey) {
    return;
  }
  const players = [];
  for (const [socketId, info] of playersBySocket.entries()) {
    if (info.roomKey !== roomKey) {
      continue;
    }
    players.push({
      socketId,
      nickname: info.nickname,
      avatarKey: info.avatarKey,
      x: info.x,
      y: info.y,
    });
  }
  io.to(roomKey).emit("room:state", { players });
};

const emitRoomMeta = (roomKey) => {
  if (!roomKey) {
    return;
  }
  let onlineCount = 0;
  for (const info of playersBySocket.values()) {
    if (info.roomKey === roomKey) {
      onlineCount += 1;
    }
  }
  const totalCount = (roomSeenUsers.get(roomKey) || new Set()).size;
  io.to(roomKey).emit("room:meta", { onlineCount, totalCount });
};

const emitRoomEvent = (roomKey, payload) => {
  if (!roomKey) {
    return;
  }
  io.to(roomKey).emit("room:event", payload);
};

const getRoomChat = (roomKey) => roomChats.get(roomKey) || [];

const appendRoomChat = (roomKey, message) => {
  const current = getRoomChat(roomKey);
  const next = [...current, message].slice(-100);
  roomChats.set(roomKey, next);
};

io.on("connection", (socket) => {
  const mode = String(socket.handshake.query.mode || "");
  const keyword = String(socket.handshake.query.keyword || "");
  const nickname = String(socket.handshake.query.nickname || "ゲスト");
  const avatarKey = String(socket.handshake.query.avatarKey || "avatar-01");

  playersBySocket.set(socket.id, {
    mode,
    keyword,
    roomKey: "",
    nickname,
    avatarKey,
    x: 300,
    y: 200,
  });

  const joinRoom = async (payload = {}) => {
    const current = playersBySocket.get(socket.id);
    if (!current) {
      return;
    }
    const nextMode = String(payload.mode || current.mode || "");
    const nextKeyword = String(payload.keyword || current.keyword || "");
    const nextNickname = String(payload.nickname || current.nickname || "ゲスト");
    const nextAvatarKey = String(payload.avatarKey || current.avatarKey || "avatar-01");
    if (!nextMode || !nextKeyword) {
      return;
    }
    const nextRoomKey = buildRoomKey(nextMode, nextKeyword);
    const prevRoomKey = current.roomKey;
    const isSameRoom = prevRoomKey && prevRoomKey === nextRoomKey;

    if (isSameRoom) {
      current.mode = nextMode;
      current.keyword = nextKeyword;
      current.nickname = nextNickname;
      current.avatarKey = nextAvatarKey;
      playersBySocket.set(socket.id, current);
      await emitRoomState(nextRoomKey);
      emitRoomMeta(nextRoomKey);
      socket.emit("room:chat:history", { messages: getRoomChat(nextRoomKey) });
      return;
    }

    if (prevRoomKey) {
      socket.leave(prevRoomKey);
    }
    socket.join(nextRoomKey);
    current.mode = nextMode;
    current.keyword = nextKeyword;
    current.nickname = nextNickname;
    current.avatarKey = nextAvatarKey;
    current.roomKey = nextRoomKey;
    playersBySocket.set(socket.id, current);
    if (!roomSeenUsers.has(nextRoomKey)) {
      roomSeenUsers.set(nextRoomKey, new Set());
    }
    roomSeenUsers.get(nextRoomKey).add(nextNickname || socket.id);
    emitRoomEvent(nextRoomKey, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "join",
      actorSocketId: socket.id,
      nickname: nextNickname || "ゲスト",
      createdAt: new Date().toISOString(),
    });

    await emitRoomState(nextRoomKey);
    emitRoomMeta(nextRoomKey);
    socket.emit("room:chat:history", { messages: getRoomChat(nextRoomKey) });
    if (prevRoomKey && prevRoomKey !== nextRoomKey) {
      await emitRoomState(prevRoomKey);
      emitRoomMeta(prevRoomKey);
    }
  };

  socket.on("room:join", async (payload) => {
    await joinRoom(payload);
  });

  socket.on("player:move", async (payload = {}) => {
    const current = playersBySocket.get(socket.id);
    if (!current) {
      return;
    }
    const x = Number(payload.x);
    const y = Number(payload.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      current.x = x;
      current.y = y;
      playersBySocket.set(socket.id, current);
    }
    if (current.roomKey) {
      await emitRoomState(current.roomKey);
      emitRoomMeta(current.roomKey);
    }
  });

  socket.on("chat:send", (payload = {}) => {
    const current = playersBySocket.get(socket.id);
    if (!current || !current.roomKey) {
      return;
    }
    const text = String(payload.message || "").trim();
    if (!text) {
      return;
    }
    const chatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      socketId: socket.id,
      nickname: current.nickname || "ゲスト",
      message: text.slice(0, 300),
      x: current.x,
      y: current.y,
      range: CHAT_RANGE,
      createdAt: new Date().toISOString(),
    };
    appendRoomChat(current.roomKey, chatMessage);
    io.to(current.roomKey).emit("room:chat:new", { message: chatMessage });
  });

  socket.on("disconnect", async () => {
    const current = playersBySocket.get(socket.id);
    playersBySocket.delete(socket.id);
    if (current?.roomKey) {
      emitRoomEvent(current.roomKey, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "leave",
        actorSocketId: socket.id,
        nickname: current.nickname || "ゲスト",
        createdAt: new Date().toISOString(),
      });
      await emitRoomState(current.roomKey);
      emitRoomMeta(current.roomKey);
    }
  });

  void joinRoom({ mode, keyword, nickname, avatarKey });
});

httpServer.listen(PORT, () => {
  console.log(`[socket] listening on http://localhost:${PORT}`);
});
