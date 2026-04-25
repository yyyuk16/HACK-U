"use client";

import { useEffect, useRef, useState } from "react";
import type { Game } from "phaser";
import { io, type Socket } from "socket.io-client";

export const MetaverseGame = () => {
  const gameRootRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [chat, setChat] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameRootRef.current || gameRef.current) {
      return;
    }

    socketRef.current = io("http://localhost:3001", {
      autoConnect: false,
      transports: ["websocket"],
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
            width: 600,
            height: 400,
            onPositionChange: ({ x, y }) => {
              setPosition({ x, y });
              console.log(`[player] x:${x}, y:${y}`);

              if (socketRef.current?.connected) {
                socketRef.current.emit("player:move", { x, y });
              }
            },
          })
        );
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
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      {loadError ? (
        <p className="max-w-[600px] text-sm text-red-600" role="alert">
          ゲームの読み込みに失敗しました: {loadError}
        </p>
      ) : null}
      <div className="rounded-md border border-slate-300 bg-slate-100 p-2 shadow-sm">
        <div ref={gameRootRef} className="h-[400px] w-[600px]" />
      </div>

      <div className="flex w-[600px] items-center gap-2">
        <input
          value={chat}
          onChange={(event) => setChat(event.target.value)}
          placeholder="チャットを入力..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          目的選択
        </button>
      </div>

      <p className="text-sm text-slate-700">
        現在座標: x={position.x}, y={position.y}
      </p>
    </div>
  );
};
