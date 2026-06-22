import { clamp, segmentContactPoint, segmentDistance, segmentIntersectsRect, type Rect, type Segment, type Vec2 } from "./geometry";

export type FighterId = "player" | "ai";

export type FighterState = {
  id: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  health: number;
  jumpTimer: number;
  jumpCooldown: number;
  dashTimer: number;
  dashCooldown: number;
  hitCooldown: number;
  parryTimer: number;
};

export type DuelInput = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  jump: boolean;
  dash: boolean;
};

export type DuelEvent =
  | { type: "body-hit"; attacker: FighterId; defender: FighterId; damage: number; point: Vec2 }
  | { type: "saber-clash"; point: Vec2 }
  | { type: "winner"; winner: FighterId };

export type DuelSnapshot = {
  player: FighterState;
  ai: FighterState;
  events: DuelEvent[];
  status: "playing" | "player-win" | "ai-win";
  time: number;
};

const WORLD = {
  minX: 126,
  maxX: 1154,
  minY: 134,
  maxY: 626,
  moveAcceleration: 1650,
  moveSpeed: 365,
  friction: 0.84,
  bodyWidth: 82,
  bodyHeight: 92,
  bodySeparation: 96,
  saberLength: 78,
  saberHitPadding: 5,
  saberClashDistance: 6,
  saberKnockback: 560,
  jumpDuration: 1.05,
  jumpCooldown: 1.35,
  jumpDashSpeed: 430,
  dashDuration: 0.18,
  dashCooldown: 0.8,
  dashSpeed: 760,
  turnSpeed: Math.PI * 1.5,
  aiTurnSpeed: Math.PI * 0.45,
  damage: 12
};

export class DuelSystem {
  private player: FighterState = createFighter("player", 370, 360, 0);
  private ai: FighterState = createFighter("ai", 910, 360, Math.PI);
  private status: DuelSnapshot["status"] = "playing";
  private time = 0;
  private aiThink = 0;
  private aiStrafe = 0;
  private aiActionThink = 0.75;

  reset(): DuelSnapshot {
    this.player = createFighter("player", 370, 360, 0);
    this.ai = createFighter("ai", 910, 360, Math.PI);
    this.status = "playing";
    this.time = 0;
    this.aiThink = 0;
    this.aiStrafe = 0;
    this.aiActionThink = 0.75;
    return this.snapshot([]);
  }

  update(deltaSeconds: number, input: DuelInput): DuelSnapshot {
    const dt = clamp(deltaSeconds, 0, 1 / 30);
    const events: DuelEvent[] = [];
    this.time += dt;

    if (this.status !== "playing") {
      return this.snapshot(events);
    }

    const aiInput = this.createAiInput(dt);
    this.applyInput(this.player, input, dt);
    this.applyInput(this.ai, aiInput, dt);
    this.turnAiTowardPlayer(dt);
    this.integrate(this.player, dt);
    this.integrate(this.ai, dt);
    this.resolveBodySeparation();
    const eventCountBeforeHits = events.length;
    this.resolveBodyHits(events);
    const landedBodyHit = events.length > eventCountBeforeHits;
    if (!landedBodyHit) {
      this.resolveSaberClash(events);
    }
    this.resolveWinner(events);

    return this.snapshot(events);
  }

  getBody(id: FighterId): Rect {
    return bodyRect(id === "player" ? this.player : this.ai);
  }

  getSaber(id: FighterId): Segment {
    return saberSegment(id === "player" ? this.player : this.ai);
  }

  private applyInput(fighter: FighterState, input: DuelInput, dt: number): void {
    const xAxis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const yAxis = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const inputLength = Math.hypot(xAxis, yAxis);
    const turnAxis = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);

    fighter.angle = normalizeAngle(fighter.angle + turnAxis * WORLD.turnSpeed * dt);

    if (inputLength > 0 && !isJumping(fighter) && !isDashing(fighter)) {
      fighter.vx += (xAxis / inputLength) * WORLD.moveAcceleration * dt;
      fighter.vy += (yAxis / inputLength) * WORLD.moveAcceleration * dt;
    }

    const speed = Math.hypot(fighter.vx, fighter.vy);
    if (speed > WORLD.moveSpeed && !isJumping(fighter) && !isDashing(fighter)) {
      fighter.vx = (fighter.vx / speed) * WORLD.moveSpeed;
      fighter.vy = (fighter.vy / speed) * WORLD.moveSpeed;
    }

    if (input.jump && fighter.jumpCooldown <= 0 && fighter.jumpTimer <= 0 && !isDashing(fighter)) {
      fighter.jumpTimer = WORLD.jumpDuration;
      fighter.jumpCooldown = WORLD.jumpCooldown;

      const inputX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const inputY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      const inputLength = Math.hypot(inputX, inputY);
      const dashX = inputLength > 0 ? inputX / inputLength : Math.cos(fighter.angle);
      const dashY = inputLength > 0 ? inputY / inputLength : Math.sin(fighter.angle);
      fighter.vx = dashX * WORLD.jumpDashSpeed;
      fighter.vy = dashY * WORLD.jumpDashSpeed;
    }

    if (input.dash && fighter.dashCooldown <= 0 && !isJumping(fighter) && !isDashing(fighter)) {
      const dashX = inputLength > 0 ? xAxis / inputLength : Math.cos(fighter.angle);
      const dashY = inputLength > 0 ? yAxis / inputLength : Math.sin(fighter.angle);
      fighter.dashTimer = WORLD.dashDuration;
      fighter.dashCooldown = WORLD.dashCooldown;
      fighter.vx = dashX * WORLD.dashSpeed;
      fighter.vy = dashY * WORLD.dashSpeed;
    }
  }

  private integrate(fighter: FighterState, dt: number): void {
    fighter.jumpTimer = Math.max(0, fighter.jumpTimer - dt);
    fighter.jumpCooldown = Math.max(0, fighter.jumpCooldown - dt);
    fighter.dashTimer = Math.max(0, fighter.dashTimer - dt);
    fighter.dashCooldown = Math.max(0, fighter.dashCooldown - dt);
    fighter.hitCooldown = Math.max(0, fighter.hitCooldown - dt);
    fighter.parryTimer = Math.max(0, fighter.parryTimer - dt);

    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
    // Keep the leap velocity stable so a jump can carry the fighter past an opponent.
    if (!isJumping(fighter) && !isDashing(fighter)) {
      fighter.vx *= WORLD.friction;
      fighter.vy *= WORLD.friction;
    }

    fighter.x = clamp(fighter.x, WORLD.minX, WORLD.maxX);
    fighter.y = clamp(fighter.y, WORLD.minY, WORLD.maxY);
  }

  private turnAiTowardPlayer(dt: number): void {
    const targetAngle = Math.atan2(this.player.y - this.ai.y, this.player.x - this.ai.x);
    const angleDelta = normalizeAngle(targetAngle - this.ai.angle);
    const maxTurn = WORLD.aiTurnSpeed * dt;
    this.ai.angle = normalizeAngle(this.ai.angle + clamp(angleDelta, -maxTurn, maxTurn));
  }

  private resolveBodySeparation(): void {
    const dx = this.ai.x - this.player.x;
    const dy = this.ai.y - this.player.y;
    const gap = Math.hypot(dx, dy) || 1;
    const overlap = WORLD.bodySeparation - gap;
    if (overlap <= 0) return;
    if (isJumping(this.player) || isJumping(this.ai)) return;

    const nx = dx / gap;
    const ny = dy / gap;
    this.player.x -= (overlap / 2) * nx;
    this.player.y -= (overlap / 2) * ny;
    this.ai.x += (overlap / 2) * nx;
    this.ai.y += (overlap / 2) * ny;
    this.player.vx -= 145 * nx;
    this.player.vy -= 145 * ny;
    this.ai.vx += 145 * nx;
    this.ai.vy += 145 * ny;
  }

  private resolveSaberClash(events: DuelEvent[]): void {
    if (this.player.parryTimer > 0 || this.ai.parryTimer > 0) return;
    if (isJumping(this.player) || isJumping(this.ai)) return;

    const playerSaber = saberSegment(this.player);
    const aiSaber = saberSegment(this.ai);
    if (segmentDistance(playerSaber, aiSaber) > WORLD.saberClashDistance) return;

    const contactPoint = segmentContactPoint(playerSaber, aiSaber);
    const dx = this.ai.x - this.player.x;
    const dy = this.ai.y - this.player.y;
    const gap = Math.hypot(dx, dy) || 1;
    const nx = dx / gap;
    const ny = dy / gap;
    this.player.vx = -nx * WORLD.saberKnockback;
    this.player.vy = -ny * WORLD.saberKnockback;
    this.ai.vx = nx * WORLD.saberKnockback;
    this.ai.vy = ny * WORLD.saberKnockback;
    this.player.parryTimer = 0.2;
    this.ai.parryTimer = 0.2;
    events.push({ type: "saber-clash", point: contactPoint });
  }

  private resolveBodyHits(events: DuelEvent[]): void {
    this.tryHit(this.player, this.ai, events);
    this.tryHit(this.ai, this.player, events);
  }

  private tryHit(attacker: FighterState, defender: FighterState, events: DuelEvent[]): void {
    if (defender.hitCooldown > 0 || attacker.parryTimer > 0) return;
    if (isJumping(attacker) || isJumping(defender)) return;

    const saber = saberSegment(attacker);
    const defenderBody = expandRect(bodyRect(defender), WORLD.saberHitPadding);
    const reachedBody = segmentIntersectsRect(saber, defenderBody);
    if (!reachedBody) return;

    defender.health = clamp(defender.health - WORLD.damage, 0, 100);
    defender.hitCooldown = 0.42;
    defender.vx += Math.cos(attacker.angle) * 500;
    defender.vy += Math.sin(attacker.angle) * 500;
    events.push({ type: "body-hit", attacker: attacker.id, defender: defender.id, damage: WORLD.damage, point: saber.b });
  }

  private resolveWinner(events: DuelEvent[]): void {
    if (this.player.health <= 0) {
      this.status = "ai-win";
      events.push({ type: "winner", winner: "ai" });
    } else if (this.ai.health <= 0) {
      this.status = "player-win";
      events.push({ type: "winner", winner: "player" });
    }
  }

  private createAiInput(dt: number): DuelInput {
    this.aiThink -= dt;
    this.aiActionThink -= dt;
    const dx = this.player.x - this.ai.x;
    const dy = this.player.y - this.ai.y;
    const gap = Math.hypot(dx, dy);
    const tooClose = gap < 112;

    if (this.aiThink <= 0) {
      this.aiThink = 0.18 + Math.random() * 0.18;
      this.aiStrafe = Math.random() > 0.5 ? 1 : -1;
    }

    const approachX = gap > 176 ? dx : tooClose ? -dx : -dy * 0.42 * this.aiStrafe;
    const approachY = gap > 176 ? dy : tooClose ? -dy : dx * 0.42 * this.aiStrafe;
    const deadZone = 18;
    let jump = false;
    let dash = false;

    if (this.aiActionThink <= 0 && !isJumping(this.ai) && !isDashing(this.ai)) {
      if (gap > 230 && this.ai.dashCooldown <= 0) {
        dash = true;
        this.aiActionThink = 0.9 + Math.random() * 0.45;
      } else if (gap <= 230 && this.ai.jumpCooldown <= 0) {
        jump = true;
        this.aiActionThink = 1.15 + Math.random() * 0.55;
      } else {
        this.aiActionThink = 0.18;
      }
    }

    return {
      left: approachX < -deadZone,
      right: approachX > deadZone,
      up: approachY < -deadZone,
      down: approachY > deadZone,
      turnLeft: false,
      turnRight: false,
      jump,
      dash
    };
  }

  private snapshot(events: DuelEvent[]): DuelSnapshot {
    return {
      player: { ...this.player },
      ai: { ...this.ai },
      events,
      status: this.status,
      time: this.time
    };
  }
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function bodyRect(fighter: FighterState): Rect {
  return {
    x: fighter.x - WORLD.bodyWidth / 2,
    y: fighter.y - WORLD.bodyHeight / 2,
    width: WORLD.bodyWidth,
    height: WORLD.bodyHeight
  };
}

export function saberSegment(fighter: FighterState): Segment {
  const saberAngle = fighter.angle;
  const hilt = {
    x: fighter.x + Math.cos(saberAngle) * 26,
    y: fighter.y + Math.sin(saberAngle) * 26
  };

  return {
    a: hilt,
    b: {
      x: hilt.x + Math.cos(saberAngle) * WORLD.saberLength,
      y: hilt.y + Math.sin(saberAngle) * WORLD.saberLength
    }
  };
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

export function jumpProgress(fighter: FighterState): number {
  if (fighter.jumpTimer <= 0) return 0;
  return 1 - fighter.jumpTimer / WORLD.jumpDuration;
}

export function jumpHeight(fighter: FighterState): number {
  const progress = jumpProgress(fighter);
  return Math.sin(progress * Math.PI) * 54;
}

export function isJumping(fighter: FighterState): boolean {
  return fighter.jumpTimer > 0;
}

export function isDashing(fighter: FighterState): boolean {
  return fighter.dashTimer > 0;
}

function createFighter(id: FighterId, x: number, y: number, angle: number): FighterState {
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    health: 100,
    jumpTimer: 0,
    jumpCooldown: 0,
    dashTimer: 0,
    dashCooldown: 0,
    hitCooldown: 0,
    parryTimer: 0
  };
}
