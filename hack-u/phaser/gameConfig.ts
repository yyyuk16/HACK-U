import * as Phaser from "phaser";
import { MainScene, type PositionPayload } from "./scenes/MainScene";

type CreateGameConfigParams = {
  parent: string | HTMLElement;
  width?: number;
  height?: number;
  backgroundPath?: string;
  playerAvatarKey?: string;
  onPositionChange?: (position: PositionPayload) => void;
};

export const createGameConfig = ({
  parent,
  width = 600,
  height = 400,
  backgroundPath,
  playerAvatarKey,
  onPositionChange,
}: CreateGameConfigParams): Phaser.Types.Core.GameConfig => {
  return {
    type: Phaser.AUTO,
    parent,
    width,
    height,
    backgroundColor: "#f8fafc",
    scene: [new MainScene({ width, height, backgroundPath, playerAvatarKey, onPositionChange })],
    physics: {
      default: "arcade",
      arcade: {
        debug: false,
      },
    },
    render: {
      antialias: false,
      pixelArt: true,
    },
  };
};
