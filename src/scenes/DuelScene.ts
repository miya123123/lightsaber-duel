import Phaser from "phaser";
import { DuelSystem, type DuelEvent, type DuelInput, type DuelSnapshot, type FighterId } from "../systems/duel";
import { bodyRect, isDashing, isJumping, jumpHeight, jumpProgress } from "../systems/duel";

const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}assets/generated/${path}`;
const PLAYER_URL = assetUrl("player_topdown_cutout.png");
const ENEMY_URL = assetUrl("enemy_topdown_cutout.png");
const PLAYER_JUMP_URL = assetUrl("player_jump_sheet.png");
const ENEMY_JUMP_URL = assetUrl("enemy_jump_sheet.png");
const PLAYER_JUMP_FRAME_SIZE = 768;
const PLAYER_ASSET_SABER_ANGLE = -1.03;
const ENEMY_ASSET_SABER_ANGLE = 1.02;

type FighterView = {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  marker: Phaser.GameObjects.Ellipse;
};

export class DuelScene extends Phaser.Scene {
  private system = new DuelSystem();
  private snapshot!: DuelSnapshot;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private views!: Record<FighterId, FighterView>;
  private fx!: Phaser.GameObjects.Graphics;
  private hud = {
    playerHealth: document.querySelector<HTMLSpanElement>("#player-health"),
    aiHealth: document.querySelector<HTMLSpanElement>("#ai-health"),
    playerState: document.querySelector<HTMLElement>("#player-state"),
    aiState: document.querySelector<HTMLElement>("#ai-state"),
    roundBanner: document.querySelector<HTMLElement>("#round-banner"),
    restartButton: document.querySelector<HTMLButtonElement>("#restart-button")
  };
  private saberClashCount = 0;
  private lastEventType = "none";
  private aiDashCount = 0;
  private aiJumpCount = 0;
  private aiMaxJumpHeight = 0;
  private wasAiDashing = false;
  private wasAiJumping = false;

  constructor() {
    super("DuelScene");
  }

  preload(): void {
    this.load.image("playerTopdown", PLAYER_URL);
    this.load.image("enemyTopdown", ENEMY_URL);
    this.load.spritesheet("playerJump", PLAYER_JUMP_URL, {
      frameWidth: PLAYER_JUMP_FRAME_SIZE,
      frameHeight: PLAYER_JUMP_FRAME_SIZE
    });
    this.load.spritesheet("enemyJump", ENEMY_JUMP_URL, {
      frameWidth: PLAYER_JUMP_FRAME_SIZE,
      frameHeight: PLAYER_JUMP_FRAME_SIZE
    });
  }

  create(): void {
    this.drawTopDownArena();

    this.fx = this.add.graphics();
    this.views = {
      player: this.createFighterView("player", 0x77e8ff),
      ai: this.createFighterView("ai", 0xff466e)
    };

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("A,D,W,S,Q,F,E,R,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.hud.restartButton?.addEventListener("click", () => this.resetDuel());
    this.input.keyboard!.on("keydown-R", () => this.resetDuel());

    this.snapshot = this.system.reset();
    this.renderSnapshot(this.snapshot);
  }

  update(_time: number, delta: number): void {
    const input = this.readInput();
    this.snapshot = this.system.update(delta / 1000, input);
    this.renderSnapshot(this.snapshot);
  }

  private readInput(): DuelInput {
    return {
      left: this.keys.A.isDown || this.cursors.left.isDown,
      right: this.keys.D.isDown || this.cursors.right.isDown,
      up: this.keys.W.isDown || this.cursors.up.isDown,
      down: this.keys.S.isDown || this.cursors.down.isDown,
      turnLeft: this.keys.Q.isDown,
      turnRight: this.keys.F.isDown,
      jump: Phaser.Input.Keyboard.JustDown(this.keys.E),
      dash: Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
    };
  }

  private resetDuel(): void {
    this.saberClashCount = 0;
    this.lastEventType = "none";
    this.aiDashCount = 0;
    this.aiJumpCount = 0;
    this.aiMaxJumpHeight = 0;
    this.wasAiDashing = false;
    this.wasAiJumping = false;
    this.snapshot = this.system.reset();
    this.hud.restartButton?.setAttribute("hidden", "true");
    this.renderSnapshot(this.snapshot);
  }

  private createFighterView(id: FighterId, saberColor: number): FighterView {
    const marker = this.add.ellipse(0, 0, 118, 96, saberColor, 0.08).setStrokeStyle(2, saberColor, 0.32);
    const shadow = this.add.ellipse(0, 0, 86, 62, 0x000000, 0.32);
    const sprite = this.add.sprite(0, 0, id === "player" ? "playerTopdown" : "enemyTopdown");
    sprite.setOrigin(id === "player" ? 0.43 : 0.5, id === "player" ? 0.71 : 0.33);
    sprite.setScale(id === "player" ? 0.17 : 0.18);

    return { sprite, shadow, marker };
  }

  private renderSnapshot(snapshot: DuelSnapshot): void {
    const aiDashing = isDashing(snapshot.ai);
    const aiJumping = isJumping(snapshot.ai);
    if (aiDashing && !this.wasAiDashing) this.aiDashCount += 1;
    if (aiJumping && !this.wasAiJumping) this.aiJumpCount += 1;
    this.aiMaxJumpHeight = Math.max(this.aiMaxJumpHeight, jumpHeight(snapshot.ai));
    this.wasAiDashing = aiDashing;
    this.wasAiJumping = aiJumping;

    this.renderFighter("player", snapshot.player);
    this.renderFighter("ai", snapshot.ai);
    this.renderEvents(snapshot.events);
    this.updateHud(snapshot);
    if (snapshot.events.some((event) => event.type === "saber-clash")) {
      document.body.dataset.lastClashPlayerVx = `${Math.round(snapshot.player.vx)}`;
      document.body.dataset.lastClashAiVx = `${Math.round(snapshot.ai.vx)}`;
    }
    document.body.dataset.gameStatus = snapshot.status;
    document.body.dataset.playerX = `${Math.round(snapshot.player.x)}`;
    document.body.dataset.playerY = `${Math.round(snapshot.player.y)}`;
    document.body.dataset.playerAngle = snapshot.player.angle.toFixed(3);
    document.body.dataset.aiX = `${Math.round(snapshot.ai.x)}`;
    document.body.dataset.aiY = `${Math.round(snapshot.ai.y)}`;
    document.body.dataset.aiAngle = snapshot.ai.angle.toFixed(3);
    document.body.dataset.playerHealth = `${Math.round(snapshot.player.health)}`;
    document.body.dataset.aiHealth = `${Math.round(snapshot.ai.health)}`;
    document.body.dataset.playerState = fighterLabel(snapshot.player);
    document.body.dataset.aiState = fighterLabel(snapshot.ai);
    document.body.dataset.playerJumping = `${isJumping(snapshot.player)}`;
    document.body.dataset.aiJumping = `${isJumping(snapshot.ai)}`;
    document.body.dataset.aiJumpHeight = `${Math.round(jumpHeight(snapshot.ai))}`;
    document.body.dataset.aiJumpProgress = `${jumpProgress(snapshot.ai).toFixed(3)}`;
    document.body.dataset.playerJumpHeight = `${Math.round(jumpHeight(snapshot.player))}`;
    document.body.dataset.playerJumpProgress = `${jumpProgress(snapshot.player).toFixed(3)}`;
    document.body.dataset.playerDashing = `${isDashing(snapshot.player)}`;
    document.body.dataset.playerDashCooldown = snapshot.player.dashCooldown.toFixed(3);
    document.body.dataset.aiDashing = `${isDashing(snapshot.ai)}`;
    document.body.dataset.aiDashCooldown = snapshot.ai.dashCooldown.toFixed(3);
    document.body.dataset.aiDashCount = `${this.aiDashCount}`;
    document.body.dataset.aiJumpCount = `${this.aiJumpCount}`;
    document.body.dataset.aiMaxJumpHeight = `${Math.round(this.aiMaxJumpHeight)}`;
    document.body.dataset.lastEvent = this.lastEventType;
    document.body.dataset.saberClashes = `${this.saberClashCount}`;
  }

  private renderFighter(id: FighterId, fighter: DuelSnapshot[FighterId]): void {
    const view = this.views[id];
    const body = bodyRect(fighter);
    const spriteBaseAngle = id === "player" ? PLAYER_ASSET_SABER_ANGLE : ENEMY_ASSET_SABER_ANGLE;
    const airborne = isJumping(fighter);
    const dashing = isDashing(fighter);
    const lift = jumpHeight(fighter);
    const jumpScale = 1 + Math.sin(jumpProgress(fighter) * Math.PI) * 0.16;
    const useJumpSheet = airborne;
    const jumpFrame = Math.min(3, Math.floor(jumpProgress(fighter) * 4));
    const baseScale = useJumpSheet ? (id === "player" ? 0.28 : 0.25) : id === "player" ? 0.17 : 0.18;

    view.marker.setPosition(fighter.x, fighter.y);
    view.marker.setAlpha(airborne ? 0.26 : 0.08);
    view.marker.setScale(airborne ? 0.76 : 1);
    view.shadow.setPosition(fighter.x, fighter.y + 12);
    view.shadow.setScale(airborne ? 0.68 : 1, airborne ? 0.58 : 1);
    view.shadow.setAlpha(airborne ? 0.18 : 0.32);
    if (useJumpSheet) {
      view.sprite.setTexture(id === "player" ? "playerJump" : "enemyJump", jumpFrame);
      view.sprite.setOrigin(0.5, 0.5);
    } else {
      view.sprite.setTexture(id === "player" ? "playerTopdown" : "enemyTopdown");
      view.sprite.setOrigin(id === "player" ? 0.43 : 0.5, id === "player" ? 0.71 : 0.33);
    }
    view.sprite.setPosition(fighter.x, fighter.y - lift);
    view.sprite.setRotation(fighter.angle - spriteBaseAngle);
    view.sprite.setScale(baseScale * jumpScale);
    view.sprite.setAlpha(fighter.hitCooldown > 0 ? 0.72 : airborne ? 1 : 0.96);
    view.sprite.setBlendMode(fighter.parryTimer > 0 || airborne ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);

    if (dashing && Math.random() < 0.55) {
      const afterimage = this.add
        .sprite(view.sprite.x, view.sprite.y, view.sprite.texture.key, view.sprite.frame.name)
        .setOrigin(view.sprite.originX, view.sprite.originY)
        .setRotation(view.sprite.rotation)
        .setScale(view.sprite.scaleX, view.sprite.scaleY)
        .setTint(id === "player" ? 0x77e8ff : 0xff466e)
        .setAlpha(0.28)
        .setDepth(view.sprite.depth - 1);
      this.tweens.add({ targets: afterimage, alpha: 0, duration: 140, onComplete: () => afterimage.destroy() });
    }

    view.sprite.setData("hurtbox", body);
  }

  private renderEvents(events: DuelEvent[]): void {
    this.fx.clear();
    for (const event of events) {
      if (event.type === "saber-clash") {
        this.saberClashCount += 1;
        this.lastEventType = event.type;
        this.flash(event.point.x, event.point.y, 0xcffbff, 42);
        this.cameras.main.shake(85, 0.004);
      }
      if (event.type === "body-hit") {
        this.lastEventType = event.type;
        this.flash(event.point.x, event.point.y, event.attacker === "player" ? 0x77e8ff : 0xff466e, 34);
        this.cameras.main.shake(110, 0.006);
      }
    }
  }

  private flash(x: number, y: number, color: number, radius: number): void {
    const ring = this.add.circle(x, y, radius, color, 0.32).setStrokeStyle(3, 0xffffff, 0.8);
    this.tweens.add({
      targets: ring,
      scale: 1.8,
      alpha: 0,
      duration: 180,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy()
    });
  }

  private updateHud(snapshot: DuelSnapshot): void {
    if (this.hud.playerHealth) this.hud.playerHealth.style.width = `${snapshot.player.health}%`;
    if (this.hud.aiHealth) this.hud.aiHealth.style.width = `${snapshot.ai.health}%`;
    if (this.hud.playerState) this.hud.playerState.textContent = fighterLabel(snapshot.player);
    if (this.hud.aiState) this.hud.aiState.textContent = fighterLabel(snapshot.ai);

    if (this.hud.roundBanner) {
      this.hud.roundBanner.textContent =
        snapshot.status === "player-win" ? "PLAYER WINS" : snapshot.status === "ai-win" ? "AI WINS" : lastEventLabel(snapshot.events);
    }

    if (snapshot.status !== "playing") this.hud.restartButton?.removeAttribute("hidden");
  }

  private drawTopDownArena(): void {
    this.add.rectangle(640, 360, 1280, 720, 0x05080f);

    const floor = this.add.graphics();
    floor.fillStyle(0x0b1220, 1);
    floor.fillRoundedRect(76, 92, 1128, 548, 26);
    floor.lineStyle(3, 0x8df3ff, 0.32);
    floor.strokeRoundedRect(76, 92, 1128, 548, 26);
    floor.lineStyle(1, 0x8df3ff, 0.13);

    for (let x = 126; x <= 1154; x += 74) {
      floor.lineBetween(x, 112, x, 620);
    }

    for (let y = 134; y <= 626; y += 58) {
      floor.lineBetween(96, y, 1184, y);
    }

    floor.lineStyle(4, 0x77e8ff, 0.42);
    floor.strokeCircle(402, 360, 136);
    floor.lineStyle(4, 0xff466e, 0.38);
    floor.strokeCircle(878, 360, 136);
    floor.lineStyle(2, 0xffd66b, 0.26);
    floor.strokeCircle(640, 360, 202);
    floor.lineStyle(3, 0xffffff, 0.16);
    floor.lineBetween(640, 108, 640, 612);

    this.add.rectangle(278, 360, 310, 454, 0x77e8ff, 0.035);
    this.add.rectangle(1002, 360, 310, 454, 0xff466e, 0.035);
  }
}

function fighterLabel(fighter: DuelSnapshot[FighterId]): string {
  if (isDashing(fighter)) return "DASH";
  if (isJumping(fighter)) return "JUMP";
  if (fighter.parryTimer > 0) return "PARRIED";
  if (fighter.hitCooldown > 0) return "HIT";
  return "READY";
}

function lastEventLabel(events: DuelEvent[]): string {
  const last = events.at(-1);
  if (!last) return "DUEL";
  if (last.type === "saber-clash") return "CLASH";
  if (last.type === "body-hit") return `${last.damage} DAMAGE`;
  return "DUEL";
}
