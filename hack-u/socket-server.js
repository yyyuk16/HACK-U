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
const PRIVATE_TALK_RANGE = 120;
const pendingPrivateRequests = new Map();
const privateSessions = new Map();
const socketToPrivateSession = new Map();
const blockedSocketsBySocket = new Map();
const sessionDistancePrompts = new Map();
const DISTANCE_PROMPT_TIMEOUT_MS = 10000;
const DISTANCE_CONTINUE_MS = 60000;

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
      userId: info.userId || undefined,
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

const getDistance = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));

const canStartPrivateTalk = (fromPlayer, toPlayer) => {
  if (!fromPlayer || !toPlayer) {
    return false;
  }
  if (!fromPlayer.roomKey || fromPlayer.roomKey !== toPlayer.roomKey) {
    return false;
  }
  return getDistance(fromPlayer, toPlayer) <= PRIVATE_TALK_RANGE;
};

const removePendingRequestsForSocket = (socketId, reason = "cancelled") => {
  for (const [requestId, request] of pendingPrivateRequests.entries()) {
    if (request.fromSocketId !== socketId && request.toSocketId !== socketId) {
      continue;
    }
    pendingPrivateRequests.delete(requestId);
    const counterpartId = request.fromSocketId === socketId ? request.toSocketId : request.fromSocketId;
    io.to(counterpartId).emit("private:request:cancelled", { requestId, reason });
  }
};

const removePendingRequestsBetween = (aSocketId, bSocketId, reason = "cancelled") => {
  for (const [requestId, request] of pendingPrivateRequests.entries()) {
    const isPair =
      (request.fromSocketId === aSocketId && request.toSocketId === bSocketId) ||
      (request.fromSocketId === bSocketId && request.toSocketId === aSocketId);
    if (!isPair) {
      continue;
    }
    pendingPrivateRequests.delete(requestId);
    io.to(request.fromSocketId).emit("private:request:cancelled", { requestId, reason });
    io.to(request.toSocketId).emit("private:request:cancelled", { requestId, reason });
  }
};

const endPrivateSession = (sessionId, payload = {}) => {
  const prompt = sessionDistancePrompts.get(sessionId);
  if (prompt?.timeout) {
    clearTimeout(prompt.timeout);
  }
  sessionDistancePrompts.delete(sessionId);
  const session = privateSessions.get(sessionId);
  if (!session) {
    return;
  }
  privateSessions.delete(sessionId);
  socketToPrivateSession.delete(session.aSocketId);
  socketToPrivateSession.delete(session.bSocketId);
  io.to(session.aSocketId).emit("call:end", { sessionId, reason: "session-ended" });
  io.to(session.bSocketId).emit("call:end", { sessionId, reason: "session-ended" });
  io.to(session.aSocketId).emit("private:session:ended", { sessionId, ...payload });
  io.to(session.bSocketId).emit("private:session:ended", { sessionId, ...payload });
};

const getBlockSet = (socketId) => {
  if (!blockedSocketsBySocket.has(socketId)) {
    blockedSocketsBySocket.set(socketId, new Set());
  }
  return blockedSocketsBySocket.get(socketId);
};

const beginDistancePrompt = (sessionId) => {
  const session = privateSessions.get(sessionId);
  if (!session || sessionDistancePrompts.has(sessionId)) {
    return;
  }
  const timeout = setTimeout(() => {
    endPrivateSession(sessionId, { reason: "distance-timeout" });
  }, DISTANCE_PROMPT_TIMEOUT_MS);
  sessionDistancePrompts.set(sessionId, {
    confirmers: new Set(),
    timeout,
  });
  io.to(session.aSocketId).emit("private:distance:prompt", {
    sessionId,
    timeoutMs: DISTANCE_PROMPT_TIMEOUT_MS,
    continueMs: DISTANCE_CONTINUE_MS,
  });
  io.to(session.bSocketId).emit("private:distance:prompt", {
    sessionId,
    timeoutMs: DISTANCE_PROMPT_TIMEOUT_MS,
    continueMs: DISTANCE_CONTINUE_MS,
  });
};

io.on("connection", (socket) => {
  const userId = Number(socket.handshake.query.userId || 0);
  const mode = String(socket.handshake.query.mode || "");
  const keyword = String(socket.handshake.query.keyword || "");
  const nickname = String(socket.handshake.query.nickname || "ゲスト");
  const avatarKey = String(socket.handshake.query.avatarKey || "avatar-01");

  playersBySocket.set(socket.id, {
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    mode,
    keyword,
    roomKey: "",
    nickname,
    avatarKey,
    x: 300,
    y: 200,
  });
  blockedSocketsBySocket.set(socket.id, new Set());

  const joinRoom = async (payload = {}) => {
    const current = playersBySocket.get(socket.id);
    if (!current) {
      return;
    }
    const nextMode = String(payload.mode || current.mode || "");
    const nextKeyword = String(payload.keyword || current.keyword || "");
    const nextUserId = Number(payload.userId || current.userId || 0);
    const nextNickname = String(payload.nickname || current.nickname || "ゲスト");
    const nextAvatarKey = String(payload.avatarKey || current.avatarKey || "avatar-01");
    if (!nextMode || !nextKeyword) {
      return;
    }
    const nextRoomKey = buildRoomKey(nextMode, nextKeyword);
    const prevRoomKey = current.roomKey;
    const isSameRoom = prevRoomKey && prevRoomKey === nextRoomKey;
    const previousSessionId = socketToPrivateSession.get(socket.id);
    if (previousSessionId && !isSameRoom) {
      endPrivateSession(previousSessionId, { reason: "room-changed" });
    }
    removePendingRequestsForSocket(socket.id, "room-changed");

    if (isSameRoom) {
      current.mode = nextMode;
      current.keyword = nextKeyword;
      current.userId = Number.isInteger(nextUserId) && nextUserId > 0 ? nextUserId : current.userId;
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
    current.userId = Number.isInteger(nextUserId) && nextUserId > 0 ? nextUserId : current.userId;
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
    const privateSessionId = socketToPrivateSession.get(socket.id);
    if (privateSessionId) {
      const session = privateSessions.get(privateSessionId);
      if (session) {
        const now = Date.now();
        if (session.continueUntil && session.continueUntil > now) {
          return;
        }
        const counterpartId = session.aSocketId === socket.id ? session.bSocketId : session.aSocketId;
        const counterpart = playersBySocket.get(counterpartId);
        const self = playersBySocket.get(socket.id);
        if (!canStartPrivateTalk(self, counterpart)) {
          beginDistancePrompt(privateSessionId);
        }
      }
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

  socket.on("private:request", (payload = {}) => {
    const current = playersBySocket.get(socket.id);
    const targetSocketId = String(payload.targetSocketId || "");
    const target = playersBySocket.get(targetSocketId);
    if (!current || !target || !targetSocketId || targetSocketId === socket.id) {
      return;
    }
    if (socketToPrivateSession.get(socket.id) || socketToPrivateSession.get(targetSocketId)) {
      socket.emit("private:error", { code: "busy", message: "会話中のためリクエストできません。" });
      return;
    }
    if (!canStartPrivateTalk(current, target)) {
      socket.emit("private:error", { code: "too-far", message: "相手が近くにいません。" });
      return;
    }
    if (getBlockSet(targetSocketId).has(socket.id)) {
      socket.emit("private:error", { code: "blocked", message: "相手が会話リクエストを受け付けていません。" });
      return;
    }
    const hasSamePending = [...pendingPrivateRequests.values()].some(
      (request) =>
        (request.fromSocketId === socket.id && request.toSocketId === targetSocketId) ||
        (request.fromSocketId === targetSocketId && request.toSocketId === socket.id)
    );
    if (hasSamePending) {
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingPrivateRequests.set(requestId, {
      requestId,
      fromSocketId: socket.id,
      toSocketId: targetSocketId,
      roomKey: current.roomKey,
      createdAt: Date.now(),
    });
    socket.emit("private:request:sent", {
      requestId,
      targetSocketId,
      targetNickname: target.nickname || "ゲスト",
    });
    io.to(targetSocketId).emit("private:request:incoming", {
      requestId,
      fromSocketId: socket.id,
      fromNickname: current.nickname || "ゲスト",
    });
  });

  socket.on("private:request:respond", (payload = {}) => {
    const requestId = String(payload.requestId || "");
    const accept = Boolean(payload.accept);
    const request = pendingPrivateRequests.get(requestId);
    if (!request || request.toSocketId !== socket.id) {
      return;
    }
    pendingPrivateRequests.delete(requestId);
    const fromPlayer = playersBySocket.get(request.fromSocketId);
    const toPlayer = playersBySocket.get(request.toSocketId);
    const rejectReasonCode = String(payload.reasonCode || "no-reason");
    const rejectReasonTextByCode = {
      busy: "今は話せません",
      later: "またあとでお願いします",
      unknown: "今回は見送ります",
      "no-reason": "リクエストが拒否されました",
    };
    if (!accept) {
      io.to(request.fromSocketId).emit("private:request:rejected", {
        requestId,
        bySocketId: socket.id,
        byNickname: toPlayer?.nickname || "ゲスト",
        reasonCode: rejectReasonCode,
        reasonText: rejectReasonTextByCode[rejectReasonCode] || rejectReasonTextByCode["no-reason"],
      });
      return;
    }
    if (!fromPlayer || !toPlayer || !canStartPrivateTalk(fromPlayer, toPlayer)) {
      io.to(request.fromSocketId).emit("private:error", {
        code: "invalid",
        message: "会話を開始できませんでした。",
      });
      return;
    }
    if (socketToPrivateSession.get(request.fromSocketId) || socketToPrivateSession.get(request.toSocketId)) {
      io.to(request.fromSocketId).emit("private:error", { code: "busy", message: "相手が会話中です。" });
      return;
    }
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    privateSessions.set(sessionId, {
      sessionId,
      aSocketId: request.fromSocketId,
      bSocketId: request.toSocketId,
      roomKey: fromPlayer.roomKey,
      createdAt: Date.now(),
    });
    socketToPrivateSession.set(request.fromSocketId, sessionId);
    socketToPrivateSession.set(request.toSocketId, sessionId);
    io.to(request.fromSocketId).emit("private:session:started", {
      sessionId,
      partnerSocketId: request.toSocketId,
      partnerNickname: toPlayer.nickname || "ゲスト",
    });
    io.to(request.toSocketId).emit("private:session:started", {
      sessionId,
      partnerSocketId: request.fromSocketId,
      partnerNickname: fromPlayer.nickname || "ゲスト",
    });
  });

  socket.on("private:message:send", (payload = {}) => {
    const sessionId = String(payload.sessionId || "");
    const text = String(payload.message || "").trim();
    if (!sessionId || !text) {
      return;
    }
    const session = privateSessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.aSocketId !== socket.id && session.bSocketId !== socket.id) {
      return;
    }
    const sender = playersBySocket.get(socket.id);
    const privateMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      socketId: socket.id,
      nickname: sender?.nickname || "ゲスト",
      message: text.slice(0, 300),
      createdAt: new Date().toISOString(),
    };
    io.to(session.aSocketId).emit("private:message:new", { message: privateMessage });
    io.to(session.bSocketId).emit("private:message:new", { message: privateMessage });
  });

  socket.on("private:session:end", (payload = {}) => {
    const requestedSessionId = String(payload.sessionId || "");
    const currentSessionId = requestedSessionId || socketToPrivateSession.get(socket.id);
    if (!currentSessionId) {
      return;
    }
    const session = privateSessions.get(currentSessionId);
    if (!session) {
      return;
    }
    if (session.aSocketId !== socket.id && session.bSocketId !== socket.id) {
      return;
    }
    endPrivateSession(currentSessionId, { reason: "manual" });
  });

  socket.on("private:block:update", (payload = {}) => {
    const targetSocketId = String(payload.targetSocketId || "");
    const block = Boolean(payload.block);
    if (!targetSocketId || targetSocketId === socket.id) {
      return;
    }
    const blockSet = getBlockSet(socket.id);
    if (block) {
      blockSet.add(targetSocketId);
      removePendingRequestsBetween(socket.id, targetSocketId, "blocked");
    } else {
      blockSet.delete(targetSocketId);
    }
    socket.emit("private:block:updated", {
      targetSocketId,
      block,
    });
  });

  socket.on("private:distance:respond", (payload = {}) => {
    const sessionId = String(payload.sessionId || "");
    const continueTalk = Boolean(payload.continueTalk);
    const session = privateSessions.get(sessionId);
    const prompt = sessionDistancePrompts.get(sessionId);
    if (!session || !prompt) {
      return;
    }
    if (session.aSocketId !== socket.id && session.bSocketId !== socket.id) {
      return;
    }
    if (!continueTalk) {
      endPrivateSession(sessionId, { reason: "distance-declined" });
      return;
    }
    prompt.confirmers.add(socket.id);
    if (
      prompt.confirmers.has(session.aSocketId) &&
      prompt.confirmers.has(session.bSocketId)
    ) {
      clearTimeout(prompt.timeout);
      sessionDistancePrompts.delete(sessionId);
      session.continueUntil = Date.now() + DISTANCE_CONTINUE_MS;
      privateSessions.set(sessionId, session);
      io.to(session.aSocketId).emit("private:distance:continued", {
        sessionId,
        continueUntil: session.continueUntil,
      });
      io.to(session.bSocketId).emit("private:distance:continued", {
        sessionId,
        continueUntil: session.continueUntil,
      });
    } else {
      io.to(socket.id).emit("private:distance:waiting", { sessionId });
    }
  });

  const relayCallSignal = (eventName, payload = {}) => {
    const sessionId = String(payload.sessionId || "");
    const session = privateSessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.aSocketId !== socket.id && session.bSocketId !== socket.id) {
      return;
    }
    const targetSocketId = session.aSocketId === socket.id ? session.bSocketId : session.aSocketId;
    io.to(targetSocketId).emit(eventName, {
      ...payload,
      sessionId,
      fromSocketId: socket.id,
    });
  };

  socket.on("call:offer", (payload = {}) => {
    relayCallSignal("call:offer", {
      sessionId: payload.sessionId,
      sdp: payload.sdp,
    });
  });

  socket.on("call:answer", (payload = {}) => {
    relayCallSignal("call:answer", {
      sessionId: payload.sessionId,
      sdp: payload.sdp,
    });
  });

  socket.on("call:ice", (payload = {}) => {
    relayCallSignal("call:ice", {
      sessionId: payload.sessionId,
      candidate: payload.candidate,
    });
  });

  socket.on("call:end", (payload = {}) => {
    relayCallSignal("call:end", {
      sessionId: payload.sessionId,
      reason: payload.reason || "manual",
    });
  });

  socket.on("disconnect", async () => {
    removePendingRequestsForSocket(socket.id, "disconnect");
    const privateSessionId = socketToPrivateSession.get(socket.id);
    if (privateSessionId) {
      endPrivateSession(privateSessionId, { reason: "disconnect" });
    }
    const current = playersBySocket.get(socket.id);
    playersBySocket.delete(socket.id);
    blockedSocketsBySocket.delete(socket.id);
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

  void joinRoom({ mode, keyword, nickname, avatarKey, userId });
});

httpServer.listen(PORT, () => {
  console.log(`[socket] listening on http://localhost:${PORT}`);
});
