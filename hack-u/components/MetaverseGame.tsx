"use client";

import { useEffect, useRef, useState } from "react";
import type { Game } from "phaser";
import { io, type Socket } from "socket.io-client";
import type { MainScene, RemotePlayer } from "@/phaser/scenes/MainScene";

type ChatMessage = {
  id: string;
  socketId: string;
  nickname: string;
  message: string;
  x?: number;
  y?: number;
  range?: number;
  createdAt: string;
};

type RoomEvent = {
  id: string;
  type: "join" | "leave";
  actorSocketId: string;
  nickname: string;
  createdAt: string;
};

type Toast = {
  id: string;
  text: string;
};

type PrivateRequestIncoming = {
  requestId: string;
  fromSocketId: string;
  fromNickname: string;
};

type RejectReasonCode = "busy" | "later" | "unknown";

type PrivateSession = {
  sessionId: string;
  partnerSocketId: string;
  partnerNickname: string;
};

type PrivateMessage = {
  id: string;
  sessionId: string;
  socketId: string;
  nickname: string;
  message: string;
  createdAt: string;
};
type RecentTalkMap = Record<string, { lastTalkAt: number; count: number }>;
type PublicProfile = {
  id: number;
  nickname: string;
  occupation?: string;
  prefecture?: string;
  bio?: string;
  favorite_tags?: string[];
};

type CallStatus =
  | "idle"
  | "requesting-media"
  | "calling"
  | "ringing"
  | "connected"
  | "ended"
  | "error";

const ALLOWED_AVATARS = [
  "avatar-01",
  "avatar-02",
  "avatar-03",
  "avatar-04",
  "avatar-05",
  "avatar-06",
  "avatar-07",
  "avatar-08",
  "avatar-09",
  "avatar-10",
] as const;
const PRIVATE_TALK_RANGE = 120;
const CALL_CONNECT_TIMEOUT_MS = 12000;
const MAX_CALL_RETRIES = 2;
const FRIENDS_STORAGE_KEY = "haku_friends_v1";
const RECENT_TALKS_STORAGE_KEY = "haku_recent_talks_v1";

function normalizeAvatarKey(value: string | null | undefined): string {
  return ALLOWED_AVATARS.includes(value as (typeof ALLOWED_AVATARS)[number])
    ? (value as string)
    : "avatar-01";
}

/** 会う（meet）用: 5:00–16:59 昼 / 17:00–18:59 夕方 / それ以外 夜 */
type MeetTimeSlot = "day" | "evening" | "night";

function getMeetTimeSlot(): MeetTimeSlot {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 17) {
    return "day";
  }
  if (hour >= 17 && hour < 19) {
    return "evening";
  }
  return "night";
}

function getMeetBackgroundPath(slot: MeetTimeSlot): string {
  const map: Record<MeetTimeSlot, string> = {
    day: "/item/background-meet-day.png",
    evening: "/item/background-meet-evening.png",
    night: "/item/background-meet-night.png",
  };
  return map[slot];
}

function meetTimeSlotLabel(slot: MeetTimeSlot): string {
  const map: Record<MeetTimeSlot, string> = {
    day: "昼",
    evening: "夕方",
    night: "夜",
  };
  return map[slot];
}

function normalizeUserKey(nickname: string): string {
  return String(nickname || "").trim().toLowerCase();
}

export const MetaverseGame = () => {
  const GAME_WIDTH = 980;
  const GAME_HEIGHT = 620;
  const gameRootRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketIdRef = useRef<string | undefined>(undefined);
  const latestRemotePlayersRef = useRef<RemotePlayer[]>([]);
  const privateSessionRef = useRef<PrivateSession | null>(null);
  const chatTabRef = useRef<"room" | "private">("room");
  const callModeRef = useRef(false);
  const callStatusRef = useRef<CallStatus>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callRetryCountRef = useRef(0);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [chat, setChat] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [roomMeta, setRoomMeta] = useState({ onlineCount: 1, totalCount: 1 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<PrivateRequestIncoming | null>(null);
  const [outgoingRequestId, setOutgoingRequestId] = useState<string | null>(null);
  const [privateSession, setPrivateSession] = useState<PrivateSession | null>(null);
  const [chatTab, setChatTab] = useState<"room" | "private">("room");
  const [privateChat, setPrivateChat] = useState("");
  const [privateUnreadCount, setPrivateUnreadCount] = useState(0);
  const [blockedSocketIds, setBlockedSocketIds] = useState<string[]>([]);
  const [distancePrompt, setDistancePrompt] = useState<{
    sessionId: string;
    timeoutMs: number;
    continueMs: number;
    waiting: boolean;
  } | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [hasLocalAudio, setHasLocalAudio] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [friendUserKeys, setFriendUserKeys] = useState<string[]>([]);
  const [friendUserIds, setFriendUserIds] = useState<number[]>([]);
  const [recentTalks, setRecentTalks] = useState<RecentTalkMap>({});
  const [prioritizeNearby, setPrioritizeNearby] = useState(true);
  const [publicProfiles, setPublicProfiles] = useState<Record<number, PublicProfile>>({});
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<
    { id: number; requester_user_id: number; requester_nickname: string }[]
  >([]);
  const [friendRequestTargetId, setFriendRequestTargetId] = useState<number | null>(null);
  const [roomInfo, setRoomInfo] = useState({
    userId: "",
    mode: "",
    keyword: "",
    nickname: "",
    avatarKey: "avatar-01",
  });
  const [meetTimeLabel, setMeetTimeLabel] = useState<string | null>(null);

  const persistFriendUserKeys = (next: string[]) => {
    setFriendUserKeys(next);
    try {
      localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // noop: localStorage が使えない環境でも動作継続
    }
  };

  const markRecentTalk = (nickname: string) => {
    const userKey = normalizeUserKey(nickname);
    if (!userKey) {
      return;
    }
    setRecentTalks((prev) => {
      const current = prev[userKey];
      const next: RecentTalkMap = {
        ...prev,
        [userKey]: {
          lastTalkAt: Date.now(),
          count: (current?.count || 0) + 1,
        },
      };
      try {
        localStorage.setItem(RECENT_TALKS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // noop
      }
      return next;
    });
  };

  const loadFriends = async () => {
    try {
      const response = await fetch("http://localhost:3000/friends", { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const friends = Array.isArray(data.friends) ? data.friends : [];
      setFriendUserIds(
        friends
          .map((friend: { user_id: number }) => Number(friend.user_id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      );
      const keys = friends
        .map((friend: { nickname?: string }) => normalizeUserKey(friend.nickname || ""))
        .filter(Boolean);
      persistFriendUserKeys(Array.from(new Set(keys)));
    } catch {
      // noop
    }
  };

  const loadIncomingFriendRequests = async () => {
    try {
      const response = await fetch("http://localhost:3000/friend-requests/incoming", {
        credentials: "include",
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const requests = Array.isArray(data.requests) ? data.requests : [];
      setIncomingFriendRequests(
        requests.map((item: { id: number; requester_user_id: number; requester_nickname: string }) => ({
          id: item.id,
          requester_user_id: item.requester_user_id,
          requester_nickname: item.requester_nickname,
        }))
      );
    } catch {
      // noop
    }
  };

  const loadPublicProfiles = async (userIds: number[]) => {
    if (userIds.length === 0) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:3000/users/public?ids=${userIds.join(",")}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const users = Array.isArray(data.users) ? data.users : [];
      const nextProfiles: Record<number, PublicProfile> = {};
      users.forEach((user: PublicProfile) => {
        if (Number.isInteger(user.id)) {
          nextProfiles[user.id] = user;
        }
      });
      setPublicProfiles((prev) => ({ ...prev, ...nextProfiles }));
    } catch {
      // noop
    }
  };

  const applyRemotePlayers = (players: RemotePlayer[]) => {
    setRemotePlayers(players);
    latestRemotePlayersRef.current = players;
    const scene = gameRef.current?.scene?.keys?.MainScene as MainScene | undefined;
    scene?.syncRemotePlayers(players, socketIdRef.current);
    const count = players.filter((player) => player.socketId !== socketIdRef.current).length;
    setRemoteCount(count);
  };

  const clearCallConnectTimer = () => {
    if (callConnectTimerRef.current) {
      clearTimeout(callConnectTimerRef.current);
      callConnectTimerRef.current = null;
    }
  };

  const buildIceServers = () => {
    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const turnUrlsRaw = process.env.NEXT_PUBLIC_TURN_URLS || process.env.NEXT_PUBLIC_TURN_URL || "";
    const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
    const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";
    const turnUrls = turnUrlsRaw
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    if (turnUrls.length > 0) {
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
    }
    return iceServers;
  };

  const updateCallStatus = (next: CallStatus) => {
    callStatusRef.current = next;
    setCallStatus(next);
  };

  const cleanupCall = () => {
    clearCallConnectTimer();
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setIsMicMuted(false);
    setHasLocalAudio(false);
  };

  const createPeerConnection = (sessionId: string) => {
    if (pcRef.current) {
      return pcRef.current;
    }
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
    });
    pc.onicecandidate = (event) => {
      if (!event.candidate || !socketRef.current?.connected) {
        return;
      }
      socketRef.current.emit("call:ice", {
        sessionId,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ontrack = (event) => {
      if (!remoteAudioRef.current) {
        return;
      }
      remoteAudioRef.current.srcObject = event.streams[0];
      void remoteAudioRef.current.play().catch(() => undefined);
      if (callStatusRef.current !== "connected") {
        updateCallStatus("connected");
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        clearCallConnectTimer();
        callRetryCountRef.current = 0;
        updateCallStatus("connected");
      } else if (state === "failed" || state === "disconnected" || state === "closed") {
        if (callStatusRef.current !== "idle") {
          updateCallStatus("ended");
        }
      }
    };
    pcRef.current = pc;
    return pc;
  };

  const ensureLocalAudio = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    localStreamRef.current = stream;
    setHasLocalAudio(true);
    return stream;
  };

  const scheduleCallConnectTimeout = (sessionId: string) => {
    clearCallConnectTimer();
    callConnectTimerRef.current = setTimeout(() => {
      if (callStatusRef.current === "connected" || !privateSessionRef.current) {
        return;
      }
      if (callRetryCountRef.current < MAX_CALL_RETRIES) {
        callRetryCountRef.current += 1;
        setCallError(`接続が遅いため再試行します (${callRetryCountRef.current}/${MAX_CALL_RETRIES})`);
        cleanupCall();
        updateCallStatus("idle");
        if (socketRef.current?.connected) {
          void startVoiceCall(true, sessionId);
        }
      } else {
        setCallError("接続がタイムアウトしました。ネットワークを確認して再試行してください。");
        cleanupCall();
        updateCallStatus("error");
      }
    }, CALL_CONNECT_TIMEOUT_MS);
  };

  useEffect(() => {
    privateSessionRef.current = privateSession;
  }, [privateSession]);

  useEffect(() => {
    try {
      const rawFriends = localStorage.getItem(FRIENDS_STORAGE_KEY);
      if (rawFriends) {
        const parsed = JSON.parse(rawFriends);
        if (Array.isArray(parsed)) {
          setFriendUserKeys(parsed.map((value) => normalizeUserKey(String(value))).filter(Boolean));
        }
      }
      const rawRecentTalks = localStorage.getItem(RECENT_TALKS_STORAGE_KEY);
      if (rawRecentTalks) {
        const parsed = JSON.parse(rawRecentTalks) as RecentTalkMap;
        if (parsed && typeof parsed === "object") {
          setRecentTalks(parsed);
        }
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    chatTabRef.current = chatTab;
    if (chatTab === "private") {
      setPrivateUnreadCount(0);
    }
  }, [chatTab]);

  useEffect(() => {
    const missingIds = remotePlayers
      .map((player) => Number(player.userId))
      .filter((id) => Number.isInteger(id) && id > 0 && !publicProfiles[id]);
    if (missingIds.length === 0) {
      return;
    }
    void loadPublicProfiles(Array.from(new Set(missingIds)));
  }, [remotePlayers, publicProfiles]);

  useEffect(() => {
    if (!gameRootRef.current || gameRef.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") ?? "";
    const keyword = params.get("keyword") ?? "";
    const userId = params.get("userId") ?? "";
    const nickname = params.get("nickname") ?? "";
    const avatarKey = normalizeAvatarKey(params.get("avatarKey"));
    setRoomInfo({ userId, mode, keyword, nickname, avatarKey });
    callModeRef.current = mode === "call" || mode === "talk" || mode === "chat";
    const meetSlot = mode === "meet" ? getMeetTimeSlot() : null;
    if (mode === "meet" && meetSlot) {
      setMeetTimeLabel(meetTimeSlotLabel(meetSlot));
    } else {
      setMeetTimeLabel(null);
    }
    const backgroundPath =
      mode === "call"
        ? "/item/background-call.png"
        : mode === "meet" && meetSlot
          ? getMeetBackgroundPath(meetSlot)
          : "/item/background-chat.png";

    socketRef.current = io("http://localhost:3001", {
      autoConnect: true,
      transports: ["websocket"],
      query: {
        mode,
        keyword,
        userId,
        nickname,
        avatarKey,
      },
    });
    socketRef.current.on("connect", () => {
      socketIdRef.current = socketRef.current?.id;
      if (mode && keyword) {
        socketRef.current?.emit("room:join", { mode, keyword, userId, nickname, avatarKey });
      }
    });
    socketRef.current.on("disconnect", () => {
      socketIdRef.current = undefined;
      applyRemotePlayers([]);
      cleanupCall();
      updateCallStatus("idle");
    });
    socketRef.current.on("room:state", (payload: { players: RemotePlayer[] }) => {
      applyRemotePlayers(payload.players ?? []);
    });
    socketRef.current.on("room:meta", (payload: { onlineCount: number; totalCount: number }) => {
      setRoomMeta({
        onlineCount: Number(payload.onlineCount) || 1,
        totalCount: Number(payload.totalCount) || 1,
      });
    });
    socketRef.current.on("room:chat:history", (payload: { messages: ChatMessage[] }) => {
      setMessages(payload.messages ?? []);
    });
    socketRef.current.on("room:chat:new", (payload: { message: ChatMessage }) => {
      setMessages((prev) => [...prev, payload.message].slice(-100));
    });
    socketRef.current.on("private:request:sent", (payload: { requestId: string }) => {
      setOutgoingRequestId(payload.requestId || null);
    });
    socketRef.current.on(
      "private:request:incoming",
      (payload: { requestId: string; fromSocketId: string; fromNickname: string }) => {
        setIncomingRequest({
          requestId: payload.requestId,
          fromSocketId: payload.fromSocketId,
          fromNickname: payload.fromNickname || "ゲスト",
        });
      }
    );
    socketRef.current.on("private:request:rejected", (payload: { byNickname?: string; reasonText?: string }) => {
      setOutgoingRequestId(null);
      const nickname = payload.byNickname || "相手";
      const reasonText = payload.reasonText ? `（${payload.reasonText}）` : "";
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [
        ...prev,
        { id: toastId, text: `${nickname}さんにリクエストが拒否されました${reasonText}` },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 2800);
    });
    socketRef.current.on("private:request:cancelled", () => {
      setIncomingRequest(null);
      setOutgoingRequestId(null);
    });
    socketRef.current.on(
      "private:session:started",
      (payload: { sessionId: string; partnerSocketId: string; partnerNickname: string }) => {
        setIncomingRequest(null);
        setOutgoingRequestId(null);
        setPrivateMessages([]);
        setPrivateSession({
          sessionId: payload.sessionId,
          partnerSocketId: payload.partnerSocketId,
          partnerNickname: payload.partnerNickname || "ゲスト",
        });
        setDistancePrompt(null);
        setPrivateUnreadCount(0);
        setChatTab("private");
        setCallError(null);
        callRetryCountRef.current = 0;
        updateCallStatus("idle");
        markRecentTalk(payload.partnerNickname || "ゲスト");
      }
    );
    socketRef.current.on("private:session:ended", (payload: { reason?: string }) => {
      const reasonMap: Record<string, string> = {
        manual: "個別会話を終了しました",
        "room-changed": "ルーム移動で個別会話が終了しました",
        "too-far": "距離が離れたため個別会話が終了しました",
        "distance-timeout": "距離が離れ、継続合意がなかったため終了しました",
        "distance-declined": "距離が離れたため個別会話を終了しました",
        disconnect: "相手が切断したため個別会話が終了しました",
      };
      if (privateSessionRef.current) {
        const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [
          ...prev,
          { id: toastId, text: reasonMap[payload.reason || ""] || "個別会話が終了しました" },
        ]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
        }, 2800);
      }
      setPrivateSession(null);
      setPrivateMessages([]);
      setPrivateChat("");
      setDistancePrompt(null);
      setPrivateUnreadCount(0);
      setChatTab("room");
      cleanupCall();
      callRetryCountRef.current = 0;
      updateCallStatus("idle");
      setCallError(null);
    });
    socketRef.current.on("private:message:new", (payload: { message: PrivateMessage }) => {
      setPrivateMessages((prev) => [...prev, payload.message].slice(-100));
      if (payload.message.socketId !== socketIdRef.current) {
        markRecentTalk(payload.message.nickname || "ゲスト");
      }
      if (chatTabRef.current !== "private") {
        setPrivateUnreadCount((prev) => prev + 1);
      }
    });
    socketRef.current.on("private:error", (payload: { message?: string }) => {
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [
        ...prev,
        { id: toastId, text: payload.message || "個別会話の処理に失敗しました" },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 2800);
    });
    socketRef.current.on("private:block:updated", (payload: { targetSocketId: string; block: boolean }) => {
      if (!payload.targetSocketId) {
        return;
      }
      setBlockedSocketIds((prev) => {
        if (payload.block) {
          return prev.includes(payload.targetSocketId) ? prev : [...prev, payload.targetSocketId];
        }
        return prev.filter((id) => id !== payload.targetSocketId);
      });
    });
    socketRef.current.on(
      "private:distance:prompt",
      (payload: { sessionId: string; timeoutMs: number; continueMs: number }) => {
        setDistancePrompt({
          sessionId: payload.sessionId,
          timeoutMs: payload.timeoutMs,
          continueMs: payload.continueMs,
          waiting: false,
        });
      }
    );
    socketRef.current.on("private:distance:waiting", () => {
      setDistancePrompt((prev) => (prev ? { ...prev, waiting: true } : prev));
    });
    socketRef.current.on("private:distance:continued", (payload: { continueUntil: number }) => {
      setDistancePrompt(null);
      const remainSec = Math.max(1, Math.round((payload.continueUntil - Date.now()) / 1000));
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [
        ...prev,
        { id: toastId, text: `距離が離れても会話を継続します（約${remainSec}秒）` },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 2800);
    });
    socketRef.current.on(
      "call:offer",
      async (payload: { sessionId: string; sdp: RTCSessionDescriptionInit; fromSocketId: string }) => {
        try {
          const currentSession = privateSessionRef.current;
          if (!currentSession || currentSession.sessionId !== payload.sessionId || !callModeRef.current) {
            return;
          }
          updateCallStatus("ringing");
          const pc = createPeerConnection(payload.sessionId);
          const localStream = await ensureLocalAudio();
          localStream.getTracks().forEach((track) => {
            const alreadyAdded = pc
              .getSenders()
              .some((sender) => sender.track && sender.track.id === track.id);
            if (!alreadyAdded) {
              pc.addTrack(track, localStream);
            }
          });
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current?.emit("call:answer", {
            sessionId: payload.sessionId,
            sdp: answer,
          });
          updateCallStatus("calling");
          scheduleCallConnectTimeout(payload.sessionId);
        } catch (error) {
          console.error("offer handling failed", error);
          setCallError("着信処理に失敗しました。");
          updateCallStatus("error");
        }
      }
    );
    socketRef.current.on("call:answer", async (payload: { sessionId: string; sdp: RTCSessionDescriptionInit }) => {
      try {
        const currentSession = privateSessionRef.current;
        if (!currentSession || currentSession.sessionId !== payload.sessionId) {
          return;
        }
        if (!pcRef.current) {
          return;
        }
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        scheduleCallConnectTimeout(payload.sessionId);
        updateCallStatus("connected");
      } catch (error) {
        console.error("answer handling failed", error);
        setCallError("通話接続に失敗しました。");
        updateCallStatus("error");
      }
    });
    socketRef.current.on("call:ice", async (payload: { sessionId: string; candidate: RTCIceCandidateInit }) => {
      try {
        const currentSession = privateSessionRef.current;
        if (!currentSession || currentSession.sessionId !== payload.sessionId || !pcRef.current) {
          return;
        }
        if (payload.candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      } catch (error) {
        console.error("ice handling failed", error);
      }
    });
    socketRef.current.on("call:end", () => {
      cleanupCall();
      callRetryCountRef.current = 0;
      updateCallStatus("ended");
      setTimeout(() => updateCallStatus("idle"), 1200);
    });
    socketRef.current.on("room:event", (event: RoomEvent) => {
      if (event.actorSocketId === socketIdRef.current) {
        return;
      }
      const text =
        event.type === "join"
          ? `${event.nickname}さんが入室しました`
          : `${event.nickname}さんが退室しました`;
      const toastId = event.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id: toastId, text }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
      }, 2800);
    });

    const mountGame = async () => {
      try {
        setLoadError(null);
        const [{ Game: PhaserGame }, { createGameConfig }] = await Promise.all([
          import("phaser"),
          import("@/phaser/gameConfig"),
        ]);

        gameRef.current = new PhaserGame(
          createGameConfig({
            parent: gameRootRef.current as HTMLDivElement,
            width: GAME_WIDTH,
            height: GAME_HEIGHT,
            backgroundPath,
            playerAvatarKey: avatarKey,
            nickname,
            onPositionChange: ({ x, y }) => {
              setPosition({ x, y });
              console.log(`[player] x:${x}, y:${y}`);

              if (socketRef.current?.connected) {
                socketRef.current.emit("player:move", { x, y, mode, keyword, userId, nickname, avatarKey });
              }
            },
          })
        );
        applyRemotePlayers(latestRemotePlayersRef.current);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Phaser 初期化失敗", e);
        setLoadError(msg);
      }
    };

    void mountGame();
    void loadFriends();
    void loadIncomingFriendRequests();
    const friendPolling = window.setInterval(() => {
      void loadIncomingFriendRequests();
    }, 10000);

    return () => {
      window.clearInterval(friendPolling);
      cleanupCall();
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
      socketIdRef.current = undefined;
      setMessages([]);
      setPrivateMessages([]);
      setRemotePlayers([]);
      setRoomMeta({ onlineCount: 1, totalCount: 1 });
      setToasts([]);
      setIncomingRequest(null);
      setOutgoingRequestId(null);
      setPrivateSession(null);
      setChatTab("room");
      setPrivateUnreadCount(0);
      setBlockedSocketIds([]);
      setDistancePrompt(null);
      updateCallStatus("idle");
      setCallError(null);
    };
  }, []);

  const sendChat = () => {
    const text = chat.trim();
    if (!text || !socketRef.current?.connected) {
      return;
    }
    socketRef.current.emit("chat:send", { message: text });
    setChat("");
  };

  const leaveRoom = () => {
    // 先に切断してから遷移すると、退出イベントが即時反映されやすい
    cleanupCall();
    socketRef.current?.disconnect();
    window.location.href = "http://localhost:3000/selecttalk.html";
  };

  const sendPrivateChat = () => {
    const text = privateChat.trim();
    if (!text || !socketRef.current?.connected || !privateSession) {
      return;
    }
    socketRef.current.emit("private:message:send", { sessionId: privateSession.sessionId, message: text });
    setPrivateChat("");
  };

  const requestPrivateTalk = (targetSocketId: string) => {
    if (!socketRef.current?.connected || privateSession || outgoingRequestId) {
      return;
    }
    socketRef.current.emit("private:request", { targetSocketId });
  };

  const respondPrivateRequest = (accept: boolean, reasonCode: RejectReasonCode = "unknown") => {
    if (!incomingRequest || !socketRef.current?.connected) {
      return;
    }
    socketRef.current.emit("private:request:respond", {
      requestId: incomingRequest.requestId,
      accept,
      reasonCode,
    });
    if (!accept) {
      setIncomingRequest(null);
    }
  };

  const endPrivateSession = () => {
    if (!privateSession || !socketRef.current?.connected) {
      return;
    }
    if (callStatusRef.current !== "idle") {
      endVoiceCall("session-end");
    }
    socketRef.current.emit("private:session:end", { sessionId: privateSession.sessionId });
  };

  const toggleBlockUser = (targetSocketId: string, nextBlock: boolean) => {
    if (!socketRef.current?.connected) {
      return;
    }
    socketRef.current.emit("private:block:update", { targetSocketId, block: nextBlock });
  };

  const toggleFriendUser = (nickname: string) => {
    const userKey = normalizeUserKey(nickname);
    if (!userKey) {
      return;
    }
    if (friendUserKeys.includes(userKey)) {
      persistFriendUserKeys(friendUserKeys.filter((value) => value !== userKey));
      return;
    }
    persistFriendUserKeys([...friendUserKeys, userKey]);
  };

  const sendFriendRequest = async (targetUserId: number, targetNickname: string) => {
    if (!Number.isInteger(targetUserId) || targetUserId <= 0 || friendRequestTargetId) {
      return;
    }
    setFriendRequestTargetId(targetUserId);
    try {
      const response = await fetch("http://localhost:3000/friend-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetUserId }),
      });
      if (!response.ok) {
        const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setToasts((prev) => [...prev, { id: toastId, text: `${targetNickname}さんへの申請に失敗しました` }]);
        setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== toastId)), 2800);
        return;
      }
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id: toastId, text: `${targetNickname}さんへフレンド申請を送りました` }]);
      setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== toastId)), 2800);
    } finally {
      setFriendRequestTargetId(null);
    }
  };

  const respondFriendRequest = async (requestId: number, accept: boolean) => {
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:3000/friend-requests/${requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept }),
      });
      if (!response.ok) {
        return;
      }
      setIncomingFriendRequests((prev) => prev.filter((item) => item.id !== requestId));
      if (accept) {
        await loadFriends();
      }
    } catch {
      // noop
    }
  };

  const respondDistancePrompt = (continueTalk: boolean) => {
    if (!distancePrompt || !socketRef.current?.connected) {
      return;
    }
    socketRef.current.emit("private:distance:respond", {
      sessionId: distancePrompt.sessionId,
      continueTalk,
    });
    if (!continueTalk) {
      setDistancePrompt(null);
    }
  };

  const showMeetGoingMessage = () => {
    const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id: toastId, text: "それでは会いに行きましょう！" }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    }, 3800);
  };

  async function startVoiceCall(isRetry = false, sessionIdOverride?: string) {
    const sessionId = sessionIdOverride || privateSessionRef.current?.sessionId;
    if (!socketRef.current?.connected || !sessionId || !callModeRef.current) {
      return;
    }
    try {
      if (!isRetry) {
        callRetryCountRef.current = 0;
      }
      setCallError(isRetry ? "再接続を試みています..." : null);
      updateCallStatus("requesting-media");
      const localStream = await ensureLocalAudio();
      const pc = createPeerConnection(sessionId);
      localStream.getTracks().forEach((track) => {
        const alreadyAdded = pc
          .getSenders()
          .some((sender) => sender.track && sender.track.id === track.id);
        if (!alreadyAdded) {
          pc.addTrack(track, localStream);
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("call:offer", {
        sessionId,
        sdp: offer,
      });
      updateCallStatus("calling");
      scheduleCallConnectTimeout(sessionId);
    } catch (error) {
      console.error("start call failed", error);
      cleanupCall();
      setCallError("マイクの利用または通話開始に失敗しました。");
      updateCallStatus("error");
    }
  }

  const endVoiceCall = (reason = "manual") => {
    if (socketRef.current?.connected && privateSession) {
      socketRef.current.emit("call:end", {
        sessionId: privateSession.sessionId,
        reason,
      });
    }
    cleanupCall();
    callRetryCountRef.current = 0;
    updateCallStatus("ended");
    setTimeout(() => updateCallStatus("idle"), 1200);
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const nextMuted = !isMicMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMicMuted(nextMuted);
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }
    return date.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const visibleMessages = messages.filter((item) => {
    if (item.socketId === socketIdRef.current) {
      return true;
    }
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      return false;
    }
    const range = Number.isFinite(item.range) ? (item.range as number) : 170;
    const dx = position.x - (item.x as number);
    const dy = position.y - (item.y as number);
    return Math.hypot(dx, dy) <= range;
  });

  const nowMs = Date.now();
  const nearbyPlayers = remotePlayers
    .filter((player) => {
      if (player.socketId === socketIdRef.current) {
        return false;
      }
      const myUserId = Number(roomInfo.userId || 0);
      const playerUserId = Number(player.userId || 0);
      if (myUserId > 0 && playerUserId > 0 && myUserId === playerUserId) {
        return false;
      }
      if (roomInfo.nickname && player.nickname === roomInfo.nickname) {
        return false;
      }
      return true;
    })
    .map((player) => {
      const dx = position.x - player.x;
      const dy = position.y - player.y;
      const distance = Math.hypot(dx, dy);
      const userKey = normalizeUserKey(player.nickname);
      const profileId = Number(player.userId || 0);
      const isFriendById = Number.isInteger(profileId) && profileId > 0 ? friendUserIds.includes(profileId) : false;
      const isFriend = isFriendById || friendUserKeys.includes(userKey);
      const recent = recentTalks[userKey];
      const profile = Number.isInteger(profileId) && profileId > 0 ? publicProfiles[profileId] : undefined;
      let score = 0;
      if (isFriend) {
        score += 1000;
      }
      if (recent?.lastTalkAt) {
        const elapsedHours = (nowMs - recent.lastTalkAt) / (1000 * 60 * 60);
        if (elapsedHours <= 24) {
          score += 500;
        } else if (elapsedHours <= 24 * 7) {
          score += 220;
        } else {
          score += 80;
        }
      }
      score += Math.max(0, 80 - Math.floor(distance / 2));
      return {
        ...player,
        distance,
        isFriend,
        isRecent: Boolean(recent),
        profile,
        priorityScore: score,
      };
    })
    .filter((player) => player.distance <= PRIVATE_TALK_RANGE)
    .sort((a, b) => {
      if (!prioritizeNearby) {
        return a.distance - b.distance;
      }
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      return a.nickname.localeCompare(b.nickname, "ja");
    });
  const partnerPlayer = privateSession
    ? remotePlayers.find((player) => player.socketId === privateSession.partnerSocketId)
    : undefined;
  const callStatusLabel: Record<CallStatus, string> = {
    idle: "待機中",
    "requesting-media": "マイク確認中",
    calling: "発信/接続中",
    ringing: "着信に応答中",
    connected: "通話中",
    ended: "通話終了",
    error: "通話エラー",
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 lg:flex-row lg:items-start">
      {loadError ? (
        <p className="text-sm text-red-600 lg:w-[340px]" role="alert">
          ゲームの読み込みに失敗しました: {loadError}
        </p>
      ) : null}
      <div className="relative flex-1 rounded-md border border-slate-300 bg-slate-100 p-2 shadow-sm">
        <div className="pointer-events-none absolute right-4 top-4 z-10 flex gap-2">
          <span className="rounded-full bg-indigo-900/85 px-3 py-1 text-xs font-semibold text-white">
            オンライン {roomMeta.onlineCount}人
          </span>
          <span className="rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white">
            総参加 {roomMeta.totalCount}人
          </span>
        </div>
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-[70%] flex-col gap-1">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="rounded-md bg-emerald-700/85 px-3 py-1 text-xs font-semibold text-white shadow"
            >
              {toast.text}
            </div>
          ))}
        </div>
        <div className="relative h-[620px] w-full max-w-[980px] overflow-hidden rounded-sm">
          <div ref={gameRootRef} className="h-[620px] w-full max-w-[980px] overflow-hidden rounded-sm" />
          {privateSession && partnerPlayer ? (
            <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
              <line
                x1={position.x}
                y1={position.y}
                x2={partnerPlayer.x}
                y2={partnerPlayer.y}
                stroke="#10b981"
                strokeWidth="3"
                strokeDasharray="8 6"
                strokeLinecap="round"
              />
            </svg>
          ) : null}
        </div>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-3 rounded-md border-4 border-[#2f3a4a] bg-[#fffdf7] p-3 shadow-[6px_6px_0_0_#2f3a4a] lg:w-[340px]">
        <p className="text-sm font-semibold text-[#2f3a4a]">
          ルーム: {roomInfo.mode || "-"} / キーワード: {roomInfo.keyword || "-"}
          {meetTimeLabel ? ` / 背景: ${meetTimeLabel}` : null}
        </p>
        <p className="text-sm font-semibold text-[#2f3a4a]">
          ニックネーム: {roomInfo.nickname || "-"}
        </p>
        <p className="text-sm font-semibold text-[#2f3a4a]">同じルームの他プレイヤー: {remoteCount}人</p>
        {incomingFriendRequests.length > 0 ? (
          <div className="rounded-md border-2 border-[#2f3a4a] bg-[#fff1f4] p-2 text-sm shadow-[3px_3px_0_0_#2f3a4a]">
            <p className="font-semibold text-[#2f3a4a]">フレンド申請が届いています</p>
            <div className="mt-2 space-y-2">
              {incomingFriendRequests.slice(0, 3).map((request) => (
                <div key={request.id} className="rounded border border-[#2f3a4a] bg-white px-2 py-1">
                  <p className="text-[#2f3a4a]">{request.requester_nickname}さん</p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void respondFriendRequest(request.id, true)}
                      className="rounded border-2 border-[#2f3a4a] bg-[#9ed8b5] px-2 py-1 text-xs font-semibold text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
                    >
                      承認
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondFriendRequest(request.id, false)}
                      className="rounded border-2 border-[#2f3a4a] bg-[#f4a6a6] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
                    >
                      拒否
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={leaveRoom}
          className="self-start rounded-md border-2 border-[#2f3a4a] bg-[#8ecdf0] px-3 py-1 text-sm font-semibold text-[#2f3a4a] shadow-[3px_3px_0_0_#2f3a4a] hover:brightness-95"
        >
          ルームから抜ける
        </button>
        <div className="rounded-md border-2 border-[#2f3a4a] bg-white p-2 shadow-[3px_3px_0_0_#2f3a4a]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#2f3a4a]">近くの人</p>
            <button
              type="button"
              onClick={() => setPrioritizeNearby((prev) => !prev)}
              className="rounded border-2 border-[#2f3a4a] bg-[#f8f1dc] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
            >
              {prioritizeNearby ? "優先表示ON" : "優先表示OFF"}
            </button>
          </div>
          <div className="space-y-2 text-sm">
            {nearbyPlayers.length === 0 ? (
              <p className="text-[#64748b]">近くに会話可能なユーザーはいません。</p>
            ) : (
              nearbyPlayers.map((player) => (
                <div key={player.socketId} className="flex items-center justify-between gap-2 rounded border border-[#2f3a4a] bg-[#fffdf7] px-2 py-1">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#2f3a4a]">{player.nickname}</p>
                    <p className="text-xs text-[#64748b]">
                      {Math.round(player.distance)}px
                      {player.isFriend ? " / 友達" : ""}
                      {player.isRecent ? " / 最近会話" : ""}
                    </p>
                    {player.profile?.occupation || player.profile?.prefecture || player.profile?.bio ? (
                      <p className="truncate text-xs text-[#64748b]">
                        {[player.profile?.occupation, player.profile?.prefecture, player.profile?.bio]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={
                        Boolean(privateSession) ||
                        Boolean(outgoingRequestId) ||
                        blockedSocketIds.includes(player.socketId)
                      }
                      onClick={() => requestPrivateTalk(player.socketId)}
                      className="rounded border-2 border-[#2f3a4a] bg-[#9ed8b5] px-2 py-1 text-xs font-medium text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      {blockedSocketIds.includes(player.socketId)
                        ? "ブロック中"
                        : outgoingRequestId
                          ? "申請中..."
                          : roomInfo.mode === "meet"
                            ? `${player.nickname}さんと会う`
                            : `${player.nickname}さんと話す`}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFriendUser(player.nickname)}
                      className="rounded border-2 border-[#2f3a4a] bg-[#f8f1dc] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
                    >
                      {player.isFriend ? "友達解除" : "友達追加"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        player.isFriend ||
                        !Number.isInteger(Number(player.userId || 0)) ||
                        Number(player.userId || 0) <= 0 ||
                        friendRequestTargetId === Number(player.userId || 0)
                      }
                      onClick={() =>
                        void sendFriendRequest(Number(player.userId || 0), player.nickname)
                      }
                      className="rounded border-2 border-[#2f3a4a] bg-[#8ecdf0] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
                    >
                      {player.isFriend
                        ? "登録済み"
                        : friendRequestTargetId === Number(player.userId || 0)
                          ? "申請中..."
                          : "フレンド申請"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        toggleBlockUser(player.socketId, !blockedSocketIds.includes(player.socketId))
                      }
                      className="rounded border-2 border-[#2f3a4a] bg-[#f4a6a6] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
                    >
                      {blockedSocketIds.includes(player.socketId) ? "解除" : "ブロック"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-[#64748b]">
            近づくと相手のステータスが表示され、フレンド申請できます。
          </p>
        </div>
        {privateSession ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-2 border-[#2f3a4a] bg-[#e9fff0] px-3 py-2 text-sm text-[#2f3a4a] shadow-[3px_3px_0_0_#2f3a4a]">
            <span>
              {privateSession.partnerNickname}さんと
              {roomInfo.mode === "meet" ? "会う約束の個別会話中" : "個別会話中"}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {roomInfo.mode === "meet" ? (
                <button
                  type="button"
                  onClick={showMeetGoingMessage}
                  className="rounded border-2 border-[#2f3a4a] bg-[#9ed8b5] px-2 py-1 text-xs font-semibold text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
                >
                  会う
                </button>
              ) : null}
              <button
                type="button"
                onClick={endPrivateSession}
                className="rounded border-2 border-[#2f3a4a] bg-[#f4a6a6] px-2 py-1 text-xs font-semibold text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95"
              >
                終了
              </button>
            </div>
          </div>
        ) : null}
        {(roomInfo.mode === "call" || roomInfo.mode === "talk" || roomInfo.mode === "chat") && privateSession ? (
          <div className="rounded-md border-2 border-[#2f3a4a] bg-[#eef7ff] p-2 text-sm text-[#2f3a4a] shadow-[3px_3px_0_0_#2f3a4a]">
            <p className="font-semibold">空間通話: {callStatusLabel[callStatus]}</p>
            {callError ? <p className="mt-1 text-xs text-red-700">{callError}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startVoiceCall()}
                disabled={callStatus !== "idle" && callStatus !== "ended"}
                className="rounded border-2 border-[#2f3a4a] bg-[#9ed8b5] px-2 py-1 text-xs font-semibold text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                通話開始
              </button>
              <button
                type="button"
                onClick={toggleMute}
                disabled={!hasLocalAudio}
                className="rounded border-2 border-[#2f3a4a] bg-[#f8f1dc] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                {isMicMuted ? "ミュート解除" : "ミュート"}
              </button>
              <button
                type="button"
                onClick={() => endVoiceCall("manual")}
                disabled={callStatus === "idle"}
                className="rounded border-2 border-[#2f3a4a] bg-[#f4a6a6] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                通話終了
              </button>
              <button
                type="button"
                onClick={() => void startVoiceCall(true)}
                disabled={callStatus === "requesting-media" || callStatus === "calling" || callStatus === "connected"}
                className="rounded border-2 border-[#2f3a4a] bg-[#8ecdf0] px-2 py-1 text-xs text-[#2f3a4a] shadow-[2px_2px_0_0_#2f3a4a] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                再試行
              </button>
            </div>
            <p className="mt-2 text-xs text-emerald-800/80">
              接続タイムアウト: {Math.round(CALL_CONNECT_TIMEOUT_MS / 1000)}秒 / 自動再試行: 最大{MAX_CALL_RETRIES}回
            </p>
            <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChatTab("room")}
            className={`rounded border-2 border-[#2f3a4a] px-3 py-1 text-sm font-semibold shadow-[2px_2px_0_0_#2f3a4a] ${
              chatTab === "room" ? "bg-[#8ecdf0] text-[#2f3a4a]" : "bg-[#fff1f4] text-[#2f3a4a]"
            }`}
          >
            ルーム
          </button>
          <button
            type="button"
            disabled={!privateSession}
            onClick={() => setChatTab("private")}
            className={`rounded px-3 py-1 text-sm ${
              chatTab === "private" ? "bg-[#9ed8b5] text-[#2f3a4a]" : "bg-[#fff1f4] text-[#2f3a4a]"
            } border-2 border-[#2f3a4a] font-semibold shadow-[2px_2px_0_0_#2f3a4a] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`}
          >
            個別{privateUnreadCount > 0 ? ` (${privateUnreadCount})` : ""}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={chatTab === "private" ? privateChat : chat}
            onChange={(event) =>
              chatTab === "private" ? setPrivateChat(event.target.value) : setChat(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (chatTab === "private") {
                  sendPrivateChat();
                } else {
                  sendChat();
                }
              }
            }}
            placeholder={chatTab === "private" ? "個別チャットを入力..." : "チャットを入力..."}
            className="flex-1 rounded-md border-2 border-[#2f3a4a] px-3 py-2 text-sm shadow-[inset_2px_2px_0_0_rgba(47,58,74,0.12)]"
          />
          <button
            type="button"
            onClick={chatTab === "private" ? sendPrivateChat : sendChat}
            className="rounded-md border-2 border-[#2f3a4a] bg-[#8ecdf0] px-4 py-2 text-sm font-semibold text-[#2f3a4a] shadow-[3px_3px_0_0_#2f3a4a] hover:brightness-95"
          >
            送信
          </button>
        </div>
        <div className="rounded-md border-2 border-[#2f3a4a] bg-white p-2 shadow-[3px_3px_0_0_#2f3a4a]">
          <p className="mb-2 text-sm font-semibold text-[#2f3a4a]">
            {chatTab === "private"
              ? `個別チャット${privateSession ? `（${privateSession.partnerNickname}さん）` : ""}`
              : "ルームチャット"}
          </p>
          <div className="max-h-[480px] space-y-1 overflow-y-auto text-sm">
            {(chatTab === "private" ? privateMessages.length === 0 : visibleMessages.length === 0) ? (
              <p className="text-[#64748b]">
                {chatTab === "private"
                  ? "個別メッセージはまだありません。"
                  : "近くのメッセージはまだありません。"}
              </p>
            ) : (
              (chatTab === "private" ? privateMessages : visibleMessages).map((item) => {
                const isMine = item.socketId === socketIdRef.current;
                return (
                  <div key={item.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`w-[95%] rounded border px-2 py-1 ${isMine ? "border-[#2f3a4a] bg-[#e8f5ff] text-[#2f3a4a]" : "border-[#2f3a4a] bg-[#fff1f4] text-[#2f3a4a]"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{item.nickname}</span>
                        <span className="text-xs text-[#64748b]">{formatTime(item.createdAt)}</span>
                      </div>
                      <p>{item.message}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
      {incomingRequest ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-4 shadow-lg">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{incomingRequest.fromNickname}</span>
              さんから個別会話リクエストが届いています。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => respondPrivateRequest(false, "busy")}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                今は話せません
              </button>
              <button
                type="button"
                onClick={() => respondPrivateRequest(false, "later")}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                またあとで
              </button>
              <button
                type="button"
                onClick={() => respondPrivateRequest(false, "unknown")}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                今回は見送る
              </button>
              <button
                type="button"
                onClick={() => respondPrivateRequest(true)}
                className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                承認
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {distancePrompt ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-md bg-white p-4 shadow-lg">
            <p className="text-sm text-slate-700">
              相手との距離が離れました。会話を終了するか、{Math.round(distancePrompt.continueMs / 1000)}
              秒間だけ継続するか選んでください。
            </p>
            {distancePrompt.waiting ? (
              <p className="mt-2 text-xs text-amber-700">あなたは継続を選択済みです。相手の回答を待っています。</p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              この選択は{Math.round(distancePrompt.timeoutMs / 1000)}秒でタイムアウトします。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => respondDistancePrompt(false)}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
              >
                終了する
              </button>
              <button
                type="button"
                onClick={() => respondDistancePrompt(true)}
                className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                続行する
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
