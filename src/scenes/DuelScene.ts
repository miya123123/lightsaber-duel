import Phaser from "phaser";
import { DuelSystem, type DuelEvent, type DuelInput, type DuelSnapshot, type FighterId, type FighterLoadout } from "../systems/duel";
import { bodyRect, isDashing, isJumping, jumpHeight, jumpProgress, saberSegments } from "../systems/duel";

type FighterView = {
  body: Phaser.GameObjects.Graphics;
  shadow: Phaser.GameObjects.Ellipse;
  marker: Phaser.GameObjects.Ellipse;
};

type DuelTestWindow = Window &
  typeof globalThis & {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  };

export class DuelScene extends Phaser.Scene {
  private system = new DuelSystem();
  private snapshot!: DuelSnapshot;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private views!: Record<FighterId, FighterView>;
  private fx!: Phaser.GameObjects.Graphics;
  private saberFx!: Phaser.GameObjects.Graphics;
  private hud = {
    playerHealth: document.querySelector<HTMLSpanElement>("#player-health"),
    aiHealth: document.querySelector<HTMLSpanElement>("#ai-health"),
    playerState: document.querySelector<HTMLElement>("#player-state"),
    aiState: document.querySelector<HTMLElement>("#ai-state"),
    roundBanner: document.querySelector<HTMLElement>("#round-banner"),
    aiLoadoutName: document.querySelector<HTMLElement>("#ai-loadout-name"),
    modeButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-ai-loadout]")),
    restartButton: document.querySelector<HTMLButtonElement>("#restart-button")
  };
  private aiLoadout: FighterLoadout = "single";
  private saberClashCount = 0;
  private lastEventType = "none";
  private aiDashCount = 0;
  private aiJumpCount = 0;
  private aiMaxJumpHeight = 0;
  private aiDoubleHitCount = 0;
  private wasAiDashing = false;
  private wasAiJumping = false;
  private lastHitDamage = 0;
  private lastHitSaberCount = 0;
  private lastHitEffectCount = 0;
  private pendingJump = false;
  private pendingDash = false;

  constructor() {
    super("DuelScene");
  }

  create(): void {
    this.drawTopDownArena();

    this.fx = this.add.graphics();
    this.saberFx = this.add.graphics();
    this.fx.setDepth(5);
    this.saberFx.setDepth(4);
    this.views = {
      player: this.createFighterView("player", 0x77e8ff),
      ai: this.createFighterView("ai", 0xff466e)
    };

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("A,D,W,S,Q,F,E,R,SPACE") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on("keydown-E", () => {
      this.pendingJump = true;
    });
    this.input.keyboard!.on("keydown-SPACE", () => {
      this.pendingDash = true;
    });
    this.hud.restartButton?.addEventListener("click", () => this.resetDuel());
    this.hud.modeButtons.forEach((button) => {
      button.addEventListener("click", () => this.selectAiLoadout(button.dataset.aiLoadout === "dual" ? "dual" : "single"));
    });
    this.input.keyboard!.on("keydown-R", () => this.resetDuel());

    this.updateLoadoutButtons();
    this.snapshot = this.system.reset(this.aiLoadout);
    this.renderSnapshot(this.snapshot);
    this.installTestHooks();
  }

  update(_time: number, delta: number): void {
    const input = this.readInput();
    this.snapshot = this.system.update(delta / 1000, input);
    this.renderSnapshot(this.snapshot);
  }

  private readInput(): DuelInput {
    const jump = this.pendingJump || Phaser.Input.Keyboard.JustDown(this.keys.E);
    const dash = this.pendingDash || Phaser.Input.Keyboard.JustDown(this.keys.SPACE);
    this.pendingJump = false;
    this.pendingDash = false;

    return {
      left: this.keys.A.isDown || this.cursors.left.isDown,
      right: this.keys.D.isDown || this.cursors.right.isDown,
      up: this.keys.W.isDown || this.cursors.up.isDown,
      down: this.keys.S.isDown || this.cursors.down.isDown,
      turnLeft: this.keys.Q.isDown,
      turnRight: this.keys.F.isDown,
      jump,
      dash
    };
  }

  private resetDuel(): void {
    this.saberClashCount = 0;
    this.lastEventType = "none";
    this.aiDashCount = 0;
    this.aiJumpCount = 0;
    this.aiMaxJumpHeight = 0;
    this.aiDoubleHitCount = 0;
    this.wasAiDashing = false;
    this.wasAiJumping = false;
    this.lastHitDamage = 0;
    this.lastHitSaberCount = 0;
    this.lastHitEffectCount = 0;
    this.snapshot = this.system.reset(this.aiLoadout);
    this.hud.restartButton?.setAttribute("hidden", "true");
    this.renderSnapshot(this.snapshot);
  }

  private selectAiLoadout(loadout: FighterLoadout): void {
    if (this.aiLoadout === loadout) return;
    this.aiLoadout = loadout;
    this.updateLoadoutButtons();
    this.resetDuel();
  }

  private updateLoadoutButtons(): void {
    const label = this.aiLoadout === "dual" ? "DUAL SABER" : "SINGLE SABER";
    if (this.hud.aiLoadoutName) this.hud.aiLoadoutName.textContent = label;
    this.hud.modeButtons.forEach((button) => {
      const selected = button.dataset.aiLoadout === this.aiLoadout;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", `${selected}`);
    });
  }

  private installTestHooks(): void {
    const testWindow = window as DuelTestWindow;
    testWindow.render_game_to_text = () => {
      const snapshot = this.snapshot;
      return JSON.stringify({
        coordinateSystem: "origin is top-left; x increases right; y increases down",
        status: snapshot.status,
        time: Number(snapshot.time.toFixed(2)),
        aiLoadout: snapshot.aiLoadout,
        player: fighterText(snapshot.player),
        ai: fighterText(snapshot.ai),
        saberClashes: this.saberClashCount,
        aiDashCount: this.aiDashCount,
        aiJumpCount: this.aiJumpCount,
        aiCenterThreat: snapshot.aiCenterThreat,
        aiCenterCounterCount: snapshot.aiCenterCounterCount,
        aiDoubleHitCount: this.aiDoubleHitCount,
        lastEvent: this.lastEventType,
        lastHitDamage: this.lastHitDamage,
        lastHitSaberCount: this.lastHitSaberCount,
        lastHitEffectCount: this.lastHitEffectCount
      });
    };
    testWindow.advanceTime = (ms: number) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let i = 0; i < steps; i += 1) {
        this.snapshot = this.system.update(1 / 60, this.readInput());
        this.renderSnapshot(this.snapshot);
      }
    };
  }

  private createFighterView(id: FighterId, saberColor: number): FighterView {
    const marker = this.add.ellipse(0, 0, 118, 96, saberColor, 0.08).setStrokeStyle(2, saberColor, 0.32);
    const shadow = this.add.ellipse(0, 0, 86, 62, 0x000000, 0.32);
    const body = this.add.graphics();
    body.setDepth(2);

    return { body, shadow, marker };
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
    this.renderSabers(snapshot);
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
    document.body.dataset.aiLoadout = snapshot.aiLoadout;
    document.body.dataset.aiSaberCount = `${saberSegments(snapshot.ai).length}`;
    document.body.dataset.playerState = fighterLabel(snapshot.player);
    document.body.dataset.aiState = fighterLabel(snapshot.ai);
    document.body.dataset.playerJumping = `${isJumping(snapshot.player)}`;
    document.body.dataset.aiJumping = `${isJumping(snapshot.ai)}`;
    document.body.dataset.aiJumpHeight = `${Math.round(jumpHeight(snapshot.ai))}`;
    document.body.dataset.aiJumpProgress = `${jumpProgress(snapshot.ai).toFixed(3)}`;
    document.body.dataset.playerJumpHeight = `${Math.round(jumpHeight(snapshot.player))}`;
    document.body.dataset.playerJumpProgress = `${jumpProgress(snapshot.player).toFixed(3)}`;
    document.body.dataset.playerShadowAlpha = this.views.player.shadow.alpha.toFixed(3);
    document.body.dataset.aiShadowAlpha = this.views.ai.shadow.alpha.toFixed(3);
    document.body.dataset.playerMarkerAlpha = this.views.player.marker.alpha.toFixed(3);
    document.body.dataset.aiMarkerAlpha = this.views.ai.marker.alpha.toFixed(3);
    document.body.dataset.playerDashing = `${isDashing(snapshot.player)}`;
    document.body.dataset.playerDashCooldown = snapshot.player.dashCooldown.toFixed(3);
    document.body.dataset.aiDashing = `${isDashing(snapshot.ai)}`;
    document.body.dataset.aiDashCooldown = snapshot.ai.dashCooldown.toFixed(3);
    document.body.dataset.aiDashCount = `${this.aiDashCount}`;
    document.body.dataset.aiJumpCount = `${this.aiJumpCount}`;
    document.body.dataset.aiMaxJumpHeight = `${Math.round(this.aiMaxJumpHeight)}`;
    document.body.dataset.aiCenterThreat = `${snapshot.aiCenterThreat}`;
    document.body.dataset.aiCenterCounterCount = `${snapshot.aiCenterCounterCount}`;
    document.body.dataset.aiDoubleHitCount = `${this.aiDoubleHitCount}`;
    document.body.dataset.lastEvent = this.lastEventType;
    document.body.dataset.lastHitDamage = `${this.lastHitDamage}`;
    document.body.dataset.lastHitSaberCount = `${this.lastHitSaberCount}`;
    document.body.dataset.lastHitEffectCount = `${this.lastHitEffectCount}`;
    document.body.dataset.saberClashes = `${this.saberClashCount}`;
  }

  private renderFighter(id: FighterId, fighter: DuelSnapshot[FighterId]): void {
    const view = this.views[id];
    const body = bodyRect(fighter);
    const isDualAi = id === "ai" && fighter.loadout === "dual";
    const airborne = isJumping(fighter);
    const dashing = isDashing(fighter);
    const lift = jumpHeight(fighter);
    const jumpScale = 1 + Math.sin(jumpProgress(fighter) * Math.PI) * 0.16;

    view.marker.setPosition(fighter.x, fighter.y);
    view.marker.setAlpha(airborne ? 0.18 : 0);
    view.marker.setScale(airborne ? 0.76 : 1);
    view.shadow.setPosition(fighter.x, fighter.y + 12);
    view.shadow.setScale(airborne ? 0.68 : 1, airborne ? 0.58 : 1);
    view.shadow.setAlpha(airborne ? 0.18 : 0);
    this.drawFighterBody(view.body, id, fighter, isDualAi, jumpScale, lift);
    view.body.setAlpha(airborne ? 1 : 0.96);
    view.body.setBlendMode(Phaser.BlendModes.NORMAL);

    if (dashing && Math.random() < 0.55) {
      const afterimage = this.add.graphics()
        .setAlpha(0.28)
        .setDepth(1);
      this.drawFighterBody(afterimage, id, fighter, isDualAi, jumpScale, lift);
      this.tweens.add({ targets: afterimage, alpha: 0, duration: 140, onComplete: () => afterimage.destroy() });
    }

    view.body.setData("hurtbox", body);
  }

  private renderSabers(snapshot: DuelSnapshot): void {
    this.saberFx.clear();
    const playerVisibleSabers = this.drawSaberSet(snapshot.player, 0x77e8ff);
    const aiVisibleSabers = this.drawSaberSet(snapshot.ai, 0xff466e);
    document.body.dataset.playerVisibleSaberCount = `${playerVisibleSabers}`;
    document.body.dataset.aiVisibleSaberCount = `${aiVisibleSabers}`;
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
        this.lastHitDamage = event.damage;
        this.lastHitSaberCount = event.saberHits;
        this.lastHitEffectCount = event.points.length;
        if (event.attacker === "ai" && event.saberHits >= 2) this.aiDoubleHitCount += 1;
        for (const point of event.points) {
          this.flash(point.x, point.y, event.attacker === "player" ? 0x77e8ff : 0xff466e, 34);
        }
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

  private drawFighterBody(
    graphics: Phaser.GameObjects.Graphics,
    id: FighterId,
    fighter: DuelSnapshot[FighterId],
    _isDualAi: boolean,
    jumpScale: number,
    lift: number
  ): void {
    const core = id === "player" ? 0xd8fbff : 0xffd1da;
    const stroke = id === "player" ? 0x21788b : 0x8d1d39;
    const suit = id === "player" ? 0x264b62 : 0x542334;
    const flash = fighter.hitCooldown > 0;
    const jumpLean = Math.sin(jumpProgress(fighter) * Math.PI * 2) * (isJumping(fighter) ? 0.16 : 0);

    graphics.clear();
    graphics.setPosition(fighter.x, fighter.y - lift);
    graphics.setRotation(fighter.angle + jumpLean);
    graphics.setScale(jumpScale);

    graphics.fillStyle(core, 1);
    graphics.lineStyle(flash ? 6 : 4, flash ? 0xffffff : stroke, 1);
    graphics.fillEllipse(0, 0, 58, 76);
    graphics.strokeEllipse(0, 0, 58, 76);
    graphics.fillStyle(suit, 1);
    graphics.fillRect(-20, -14, 40, 28);
    graphics.fillStyle(0x10131b, 1);
    graphics.fillRect(12, -7, 20, 14);
    graphics.fillStyle(core, 1);
    graphics.fillCircle(8, -11, 5);
    graphics.fillCircle(8, 11, 5);
  }

  private drawSaberSet(fighter: DuelSnapshot[FighterId], color: number): number {
    const lift = jumpHeight(fighter);
    const angle = fighter.angle;
    const segments = saberSegments(fighter);
    for (const segment of segments) {
      const hiltStart = {
        x: segment.a.x - Math.cos(angle) * 14,
        y: segment.a.y - Math.sin(angle) * 14 - lift
      };
      const bladeStart = {
        x: segment.a.x + Math.cos(angle) * 10,
        y: segment.a.y + Math.sin(angle) * 10 - lift
      };
      const bladeEnd = {
        x: segment.b.x,
        y: segment.b.y - lift
      };

      this.saberFx.lineStyle(8, 0x222222, 1);
      this.saberFx.lineBetween(hiltStart.x, hiltStart.y, bladeStart.x, bladeStart.y);
      this.saberFx.lineStyle(18, color, 0.16);
      this.saberFx.lineBetween(bladeStart.x, bladeStart.y, bladeEnd.x, bladeEnd.y);
      this.saberFx.fillStyle(color, 0.16);
      this.saberFx.fillCircle(bladeEnd.x, bladeEnd.y, 9);
      this.saberFx.lineStyle(11, color, 0.86);
      this.saberFx.lineBetween(bladeStart.x, bladeStart.y, bladeEnd.x, bladeEnd.y);
      this.saberFx.fillStyle(color, 0.86);
      this.saberFx.fillCircle(bladeEnd.x, bladeEnd.y, 5.5);
      this.saberFx.lineStyle(4, 0xffffff, 0.96);
      this.saberFx.lineBetween(bladeStart.x, bladeStart.y, bladeEnd.x, bladeEnd.y);
      this.saberFx.fillStyle(0xffffff, 0.96);
      this.saberFx.fillCircle(bladeEnd.x, bladeEnd.y, 2);
    }
    return segments.length;
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

function fighterText(fighter: DuelSnapshot[FighterId]) {
  return {
    x: Math.round(fighter.x),
    y: Math.round(fighter.y),
    vx: Math.round(fighter.vx),
    vy: Math.round(fighter.vy),
    angle: Number(fighter.angle.toFixed(3)),
    health: Math.round(fighter.health),
    state: fighterLabel(fighter),
    jumping: isJumping(fighter),
    jumpHeight: Math.round(jumpHeight(fighter)),
    dashing: isDashing(fighter),
    sabers: saberSegments(fighter).map((segment) => ({
      a: { x: Math.round(segment.a.x), y: Math.round(segment.a.y) },
      b: { x: Math.round(segment.b.x), y: Math.round(segment.b.y) }
    }))
  };
}
