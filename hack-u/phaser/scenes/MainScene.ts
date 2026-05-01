import * as Phaser from "phaser";

export type PositionPayload = {
  x: number;
  y: number;
};

export type RemotePlayer = {
  socketId: string;
  userId?: number;
  nickname: string;
  avatarKey?: string;
  x: number;
  y: number;
};

type MainSceneOptions = {
  width: number;
  height: number;
  backgroundPath?: string;
  playerAvatarKey?: string;
  nickname?: string;
  onPositionChange?: (position: PositionPayload) => void;
};

const FRAME_W = 32;
const FRAME_H = 32;
const COLS = 3;

const FRONT_ROW = 0;
const LEFT_ROW = 1;
const RIGHT_ROW = 2;
const BACK_ROW = 3;

type Facing = "down" | "left" | "right" | "up";

const ROW_FOR_FACING: Record<Facing, number> = {
  down: FRONT_ROW,
  left: LEFT_ROW,
  right: RIGHT_ROW,
  up: BACK_ROW,
};

const idleFrame = (facing: Facing) => ROW_FOR_FACING[facing] * COLS + 1;
const DEFAULT_AVATAR_KEY = "avatar-01";
const AVATAR_KEYS = [
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
];

export class MainScene extends Phaser.Scene {
  private readonly options: MainSceneOptions;

  private player!: Phaser.GameObjects.Sprite;
  private playerLabel!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  private speed = 180;

  private lastSent = { x: 0, y: 0 };

  private lastFacing: Facing = "down";

  private remotePlayers = new Map<
    string,
    { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; avatarKey: string }
  >();

  constructor(options: MainSceneOptions) {
    super("MainScene");
    this.options = options;
  }

  preload(): void {
    this.load.image("roomBg", this.options.backgroundPath || "/item/background.png");
    for (const avatarKey of AVATAR_KEYS) {
      this.load.spritesheet(avatarKey, `/item/avatars/${avatarKey}.png`, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }
  }

  create(): void {
    const w = this.options.width;
    const h = this.options.height;
    const bg = this.add.image(w / 2, h / 2, "roomBg");
    const scale = Math.max(w / bg.width, h / bg.height);
    bg.setScale(scale).setScrollFactor(0);
    bg.setDepth(0);

    const makeWalk = (avatarKey: string, key: string, row: number) => {
      const start = row * COLS;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(avatarKey, { start, end: start + 2 }),
        frameRate: 10,
        repeat: -1,
      });
    };
    for (const avatarKey of AVATAR_KEYS) {
      makeWalk(avatarKey, `${avatarKey}-walk-down`, FRONT_ROW);
      makeWalk(avatarKey, `${avatarKey}-walk-left`, LEFT_ROW);
      makeWalk(avatarKey, `${avatarKey}-walk-right`, RIGHT_ROW);
      makeWalk(avatarKey, `${avatarKey}-walk-up`, BACK_ROW);
    }

    const playerAvatarKey = this.options.playerAvatarKey || DEFAULT_AVATAR_KEY;
    this.player = this.add.sprite(w / 2, h / 2, playerAvatarKey, idleFrame("down"));
    this.player.setOrigin(0.5, 0.5);
    this.player.setDepth(1);
    this.playerLabel = this.add.text(
      this.player.x,
      this.player.y - 34,
      this.options.nickname || "あなた",
      {
        fontSize: "12px",
        color: "#1f2937",
        backgroundColor: "#ffffffcc",
        padding: { x: 4, y: 2 },
      }
    );
    this.playerLabel.setOrigin(0.5);
    this.playerLabel.setDepth(2);

    this.cursors = this.input.keyboard?.createCursorKeys() as Phaser.Types.Input.Keyboard.CursorKeys;
    this.wasd = this.input.keyboard?.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as MainScene["wasd"];

    this.notifyPosition();
  }

  update(_: number, delta: number): void {
    const direction = new Phaser.Math.Vector2(0, 0);

    if (this.cursors.left?.isDown || this.wasd.left.isDown) {
      direction.x -= 1;
    }
    if (this.cursors.right?.isDown || this.wasd.right.isDown) {
      direction.x += 1;
    }
    if (this.cursors.up?.isDown || this.wasd.up.isDown) {
      direction.y -= 1;
    }
    if (this.cursors.down?.isDown || this.wasd.down.isDown) {
      direction.y += 1;
    }

    if (direction.lengthSq() === 0) {
      this.player.anims.stop();
      this.player.setFrame(idleFrame(this.lastFacing));
      return;
    }

    direction.normalize();

    let animKey: string;
    if (Math.abs(direction.x) > Math.abs(direction.y)) {
      animKey = direction.x < 0 ? "walk-left" : "walk-right";
      this.lastFacing = direction.x < 0 ? "left" : "right";
    } else {
      animKey = direction.y < 0 ? "walk-up" : "walk-down";
      this.lastFacing = direction.y < 0 ? "up" : "down";
    }
    const playerAvatarKey = this.options.playerAvatarKey || DEFAULT_AVATAR_KEY;
    const playerAnimKey = `${playerAvatarKey}-${animKey}`;

    if (this.player.anims.currentAnim?.key !== playerAnimKey) {
      this.player.play(playerAnimKey);
    }

    const distance = (this.speed * delta) / 1000;
    this.player.x += direction.x * distance;
    this.player.y += direction.y * distance;

    const halfW = this.player.displayWidth / 2;
    const halfH = this.player.displayHeight / 2;
    this.player.x = Phaser.Math.Clamp(this.player.x, halfW, this.options.width - halfW);
    this.player.y = Phaser.Math.Clamp(this.player.y, halfH, this.options.height - halfH);
    this.playerLabel.setPosition(this.player.x, this.player.y - 34);

    this.notifyPosition();
  }

  private notifyPosition(): void {
    const x = Math.round(this.player.x);
    const y = Math.round(this.player.y);
    if (x === this.lastSent.x && y === this.lastSent.y) {
      return;
    }
    this.lastSent = { x, y };
    this.options.onPositionChange?.({ x, y });
  }

  public syncRemotePlayers(players: RemotePlayer[], selfSocketId?: string): void {
    const keepIds = new Set<string>();
    for (const remote of players) {
      if (remote.socketId === selfSocketId) {
        continue;
      }
      keepIds.add(remote.socketId);
      const existing = this.remotePlayers.get(remote.socketId);
      const avatarKey = AVATAR_KEYS.includes(remote.avatarKey || "") ? (remote.avatarKey as string) : DEFAULT_AVATAR_KEY;
      if (existing) {
        if (existing.avatarKey !== avatarKey) {
          existing.sprite.destroy();
          existing.label.destroy();
          this.remotePlayers.delete(remote.socketId);
        } else {
          existing.sprite.setPosition(remote.x, remote.y);
          existing.label.setPosition(remote.x, remote.y - 34);
          existing.label.setText(remote.nickname);
          continue;
        }
      }

      const sprite = this.add.sprite(remote.x, remote.y, avatarKey, idleFrame("down"));
      sprite.setDepth(1);
      const label = this.add.text(remote.x, remote.y - 34, remote.nickname, {
        fontSize: "12px",
        color: "#1f2937",
        backgroundColor: "#ffffffcc",
        padding: { x: 4, y: 2 },
      });
      label.setOrigin(0.5);
      label.setDepth(2);
      this.remotePlayers.set(remote.socketId, { sprite, label, avatarKey });
    }

    for (const [socketId, object] of this.remotePlayers.entries()) {
      if (!keepIds.has(socketId)) {
        object.sprite.destroy();
        object.label.destroy();
        this.remotePlayers.delete(socketId);
      }
    }
  }
}
