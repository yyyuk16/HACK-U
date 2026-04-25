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

const ALLOWED_AVATARS = [
  "avatar-01",
  "avatar-02",
  "avatar-03",
  "avatar-04",
  "avatar-05",
] as const;

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

export const MetaverseGame = () => {
  const GAME_WIDTH = 980;
  const GAME_HEIGHT = 620;
  const gameRootRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const socketIdRef = useRef<string | undefined>(undefined);
  const latestRemotePlayersRef = useRef<RemotePlayer[]>([]);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [chat, setChat] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteCount, setRemoteCount] = useState(0);
  const [roomMeta, setRoomMeta] = useState({ onlineCount: 1, totalCount: 1 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [roomInfo, setRoomInfo] = useState({
    mode: "",
    keyword: "",
    nickname: "",
    avatarKey: "avatar-01",
  });
  const [meetTimeLabel, setMeetTimeLabel] = useState<string | null>(null);

  const applyRemotePlayers = (players: RemotePlayer[]) => {
    latestRemotePlayersRef.current = players;
    const scene = gameRef.current?.scene?.keys?.MainScene as MainScene | undefined;
    scene?.syncRemotePlayers(players, socketIdRef.current);
    const count = players.filter((player) => player.socketId !== socketIdRef.current).length;
    setRemoteCount(count);
  };

  useEffect(() => {
    if (!gameRootRef.current || gameRef.current) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") ?? "";
    const keyword = params.get("keyword") ?? "";
    const nickname = params.get("nickname") ?? "";
    const avatarKey = normalizeAvatarKey(params.get("avatarKey"));
    setRoomInfo({ mode, keyword, nickname, avatarKey });
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
        nickname,
        avatarKey,
      },
    });
    socketRef.current.on("connect", () => {
      socketIdRef.current = socketRef.current?.id;
      if (mode && keyword) {
        socketRef.current?.emit("room:join", { mode, keyword, nickname, avatarKey });
      }
    });
    socketRef.current.on("disconnect", () => {
      socketIdRef.current = undefined;
      applyRemotePlayers([]);
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
            onPositionChange: ({ x, y }) => {
              setPosition({ x, y });
              console.log(`[player] x:${x}, y:${y}`);

              if (socketRef.current?.connected) {
                socketRef.current.emit("player:move", { x, y, mode, keyword, nickname, avatarKey });
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

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
      socketIdRef.current = undefined;
      setMessages([]);
      setRoomMeta({ onlineCount: 1, totalCount: 1 });
      setToasts([]);
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
    socketRef.current?.disconnect();
    window.location.href = "http://localhost:3000/selecttalk.html";
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
        <div
          ref={gameRootRef}
          className="h-[620px] w-full max-w-[980px] overflow-hidden rounded-sm"
        />
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-3 rounded-md border border-slate-300 bg-white p-3 shadow-sm lg:w-[340px]">
        <p className="text-sm text-slate-700">
          ルーム: {roomInfo.mode || "-"} / キーワード: {roomInfo.keyword || "-"}
          {meetTimeLabel ? ` / 背景: ${meetTimeLabel}` : null}
        </p>
        <p className="text-sm text-slate-700">
          ニックネーム: {roomInfo.nickname || "-"} / 座標: x={position.x}, y={position.y}
        </p>
        <p className="text-sm text-slate-700">同じルームの他プレイヤー: {remoteCount}人</p>
        <button
          type="button"
          onClick={leaveRoom}
          className="self-start rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          ルームから抜ける
        </button>
        <div className="flex items-center gap-2">
          <input
            value={chat}
            onChange={(event) => setChat(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendChat();
              }
            }}
            placeholder="チャットを入力..."
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={sendChat}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            送信
          </button>
        </div>
        <div className="rounded-md border border-slate-300 bg-white p-2">
          <p className="mb-2 text-sm font-semibold text-slate-700">ルームチャット（近い人のみ表示）</p>
          <div className="max-h-[480px] space-y-1 overflow-y-auto text-sm">
            {visibleMessages.length === 0 ? (
              <p className="text-slate-500">近くのメッセージはまだありません。</p>
            ) : (
              visibleMessages.map((item) => {
                const isMine = item.socketId === socketIdRef.current;
                return (
                  <div key={item.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`w-[95%] rounded px-2 py-1 ${isMine ? "bg-indigo-100 text-indigo-900" : "bg-slate-100 text-slate-700"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{item.nickname}</span>
                        <span className="text-xs text-slate-500">{formatTime(item.createdAt)}</span>
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
    </div>
  );
};
