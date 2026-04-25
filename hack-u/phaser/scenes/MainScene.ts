import * as Phaser from "phaser";

export type PositionPayload = {
  x: number;
  y: number;
};

type MainSceneOptions = {
  width: number;
  height: number;
  onPositionChange?: (position: PositionPayload) => void;
};

const FRAME_W = 48;
const FRAME_H = 48;
const COLS = 6;

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

export class MainScene extends Phaser.Scene {
  private readonly options: MainSceneOptions;

  private player!: Phaser.GameObjects.Sprite;

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

  constructor(options: MainSceneOptions) {
    super("MainScene");
    this.options = options;
  }

  preload(): void {
    this.load.image("roomBg", "/item/background.png");
    this.load.spritesheet("princess", "/item/princess-spritesheet.png", {
      frameWidth: FRAME_W,
      frameHeight: FRAME_H,
    });
  }

  create(): void {
    const w = this.options.width;
    const h = this.options.height;
    const bg = this.add.image(w / 2, h / 2, "roomBg");
    const scale = Math.max(w / bg.width, h / bg.height);
    bg.setScale(scale).setScrollFactor(0);
    bg.setDepth(0);

    const makeWalk = (key: string, row: number) => {
      const start = row * COLS;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers("princess", { start, end: start + 2 }),
        frameRate: 10,
        repeat: -1,
      });
    };
    makeWalk("walk-down", FRONT_ROW);
    makeWalk("walk-left", LEFT_ROW);
    makeWalk("walk-right", RIGHT_ROW);
    makeWalk("walk-up", BACK_ROW);

    this.player = this.add.sprite(w / 2, h / 2, "princess", idleFrame("down"));
    this.player.setOrigin(0.5, 0.5);
    this.player.setDepth(1);

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

    if (this.player.anims.currentAnim?.key !== animKey) {
      this.player.play(animKey);
    }

    const distance = (this.speed * delta) / 1000;
    this.player.x += direction.x * distance;
    this.player.y += direction.y * distance;

    const halfW = this.player.displayWidth / 2;
    const halfH = this.player.displayHeight / 2;
    this.player.x = Phaser.Math.Clamp(this.player.x, halfW, this.options.width - halfW);
    this.player.y = Phaser.Math.Clamp(this.player.y, halfH, this.options.height - halfH);

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
}
