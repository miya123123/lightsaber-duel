import { expect, test, type Page } from "@playwright/test";
import { bodyHitDamage, bodyHitSabers, isDualCenterThreat, saberSegments, type FighterState } from "../src/systems/duel";

async function openDuel(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => document.body.dataset.gameStatus)).toBe("playing");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("1");
}

async function pressJump(page: Page): Promise<void> {
  await page.evaluate(() => window.focus());
  await page.keyboard.up("E");
  await page.keyboard.press("E");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.playerState), { timeout: 3_000 }).toBe("JUMP");
}

test("boots into a playable lightsaber duel with dash and without a Slash control", async ({ page }) => {
  await openDuel(page);
  await expect(page.locator("#round-banner")).toContainText("DUEL");
  await expect(page.locator("#controls-strip")).toContainText("WASD");
  await expect(page.locator("#controls-strip")).toContainText("ARROWS");
  await expect(page.locator("#controls-strip")).toContainText("Q / F");
  await expect(page.locator("#controls-strip")).toContainText("TURN");
  await expect(page.locator("#controls-strip")).toContainText("SPACE");
  await expect(page.locator("#controls-strip")).toContainText("DASH");
  await expect(page.locator("#controls-strip")).not.toContainText("SLASH");
  await expect(page.locator("#controls-strip")).toContainText("JUMP");
  await expect(page.locator("#controls-strip")).not.toContainText("GUARD");
  await expect(page.locator("#controls-strip")).not.toContainText("SHIFT");

  const imageRequests = await page.evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)|assets\/generated|data:image/i.test(name));
  });
  expect(imageRequests).toEqual([]);
  await expect(page.locator("#enemy-mode")).toContainText("一刀流AI");
  await expect(page.locator("#enemy-mode")).toContainText("二刀流AI");
  expect(await page.evaluate(() => document.body.dataset.aiLoadout)).toBe("single");
  expect(await page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("1");

  await page.keyboard.press("R");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.gameStatus)).toBe("playing");

  const startX = Number(await page.evaluate(() => document.body.dataset.playerX));
  const startY = Number(await page.evaluate(() => document.body.dataset.playerY));

  await page.keyboard.down("D");
  await page.waitForTimeout(450);
  await page.keyboard.up("D");
  const movedRightX = Number(await page.evaluate(() => document.body.dataset.playerX));
  expect(movedRightX).toBeGreaterThan(startX + 10);

  await page.keyboard.down("W");
  await page.waitForTimeout(350);
  await page.keyboard.up("W");
  const movedUpY = Number(await page.evaluate(() => document.body.dataset.playerY));
  expect(movedUpY).toBeLessThan(startY - 12);

  await page.keyboard.down("S");
  await page.waitForTimeout(350);
  await page.keyboard.up("S");
  const movedDownY = Number(await page.evaluate(() => document.body.dataset.playerY));
  expect(movedDownY).toBeGreaterThan(movedUpY + 12);

  await expect(page.locator("#ai-state")).toBeVisible();
});

test("can switch between single-saber and dual-saber AI fighters", async ({ page }) => {
  await openDuel(page);
  await expect(page.locator("#ai-loadout-name")).toContainText("SINGLE SABER");
  expect(await page.evaluate(() => document.body.dataset.aiLoadout)).toBe("single");
  expect(await page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("1");

  await page.getByRole("button", { name: "二刀流AI" }).click();
  await expect(page.locator("#ai-loadout-name")).toContainText("DUAL SABER");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiLoadout)).toBe("dual");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("2");
  await expect(page.locator("#round-banner")).toContainText("DUEL");

  const resetState = await page.evaluate(() => ({
    aiHealth: document.body.dataset.aiHealth,
    playerHealth: document.body.dataset.playerHealth,
    aiX: Number(document.body.dataset.aiX),
    aiY: Number(document.body.dataset.aiY)
  }));
  expect(resetState.aiHealth).toBe("100");
  expect(resetState.playerHealth).toBe("100");
  expect(resetState.aiX).toBeGreaterThan(850);
  expect(resetState.aiY).toBeGreaterThan(300);

  await page.getByRole("button", { name: "一刀流AI" }).click();
  await expect(page.locator("#ai-loadout-name")).toContainText("SINGLE SABER");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiLoadout)).toBe("single");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("1");
});

test("dual-saber simultaneous body contact counts both blades for double damage", async ({ page }) => {
  const singleAttacker = makeFighter({ id: "ai", loadout: "single", x: 100, y: 100, angle: 0 });
  const dualAttacker = makeFighter({ id: "ai", loadout: "dual", x: 100, y: 100, angle: 0 });
  const defender = makeFighter({ id: "player", loadout: "single", x: 168, y: 100, angle: Math.PI });

  expect(bodyHitSabers(singleAttacker, defender)).toHaveLength(1);
  expect(bodyHitSabers(dualAttacker, defender)).toHaveLength(2);
  expect(bodyHitDamage(singleAttacker, defender)).toBe(12);
  expect(bodyHitDamage(dualAttacker, defender)).toBe(24);

  await openDuel(page);
  await page.getByRole("button", { name: "二刀流AI" }).click();
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiSaberCount)).toBe("2");
  expect(await page.evaluate(() => document.body.dataset.lastHitDamage)).toBe("0");
  expect(await page.evaluate(() => document.body.dataset.lastHitSaberCount)).toBe("0");
  expect(await page.evaluate(() => document.body.dataset.lastHitEffectCount)).toBe("0");
});

test("dual-saber collider follows the narrowed 60 degree visible blade fan", () => {
  const dualAttacker = makeFighter({ id: "ai", loadout: "dual", x: 100, y: 100, angle: 0 });
  const centerDefender = makeFighter({ id: "player", loadout: "single", x: 168, y: 100, angle: Math.PI });
  const [upperSaber, lowerSaber] = saberSegments(dualAttacker);
  const bladeOpening = Math.acos(
    ((upperSaber.b.x - upperSaber.a.x) * (lowerSaber.b.x - lowerSaber.a.x) +
      (upperSaber.b.y - upperSaber.a.y) * (lowerSaber.b.y - lowerSaber.a.y)) /
      (Math.hypot(upperSaber.b.x - upperSaber.a.x, upperSaber.b.y - upperSaber.a.y) *
        Math.hypot(lowerSaber.b.x - lowerSaber.a.x, lowerSaber.b.y - lowerSaber.a.y))
  );
  const visibleTipFan = Math.abs(Math.atan2(lowerSaber.b.y - dualAttacker.y, lowerSaber.b.x - dualAttacker.x)) * 2;

  expect(upperSaber.a.y).toBeLessThan(dualAttacker.y);
  expect(upperSaber.b.y).toBeLessThan(dualAttacker.y);
  expect(lowerSaber.a.y).toBeGreaterThan(dualAttacker.y);
  expect(lowerSaber.b.y).toBeGreaterThan(dualAttacker.y);
  expect(lowerSaber.a.y - upperSaber.a.y).toBeLessThan(34);
  expect(bladeOpening).toBeCloseTo(Math.PI / 3, 4);
  expect(visibleTipFan).toBeGreaterThan(1);
  expect(visibleTipFan).toBeLessThan(1.1);
  expect(bodyHitSabers(dualAttacker, centerDefender)).toHaveLength(2);
  expect(bodyHitDamage(dualAttacker, centerDefender)).toBe(24);
});

test("dual-saber enemy detects a saber aimed through its forward center lane", () => {
  const ai = makeFighter({ id: "ai", loadout: "dual", x: 200, y: 100, angle: Math.PI });
  const centeredPlayer = makeFighter({ id: "player", loadout: "single", x: 0, y: 100, angle: 0 });
  const offsetPlayer = makeFighter({ id: "player", loadout: "single", x: 0, y: 150, angle: 0 });
  const turnedPlayer = makeFighter({ id: "player", loadout: "single", x: 0, y: 100, angle: Math.PI / 2 });
  const jumpingPlayer = makeFighter({ id: "player", loadout: "single", x: 0, y: 100, angle: 0 });
  jumpingPlayer.jumpTimer = 0.5;
  const singleAi = makeFighter({ ...ai, loadout: "single" });

  expect(isDualCenterThreat(centeredPlayer, ai)).toBe(true);
  expect(isDualCenterThreat(offsetPlayer, ai)).toBe(false);
  expect(isDualCenterThreat(turnedPlayer, ai)).toBe(false);
  expect(isDualCenterThreat(jumpingPlayer, ai)).toBe(false);
  expect(isDualCenterThreat(centeredPlayer, singleAi)).toBe(false);
});

test("dual-saber enemy counters a center thrust with a double-hit dash", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  await openDuel(page);
  await page.getByRole("button", { name: "二刀流AI" }).click();

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiCenterCounterCount ?? "0")), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiDoubleHitCount ?? "0")), { timeout: 8_000 })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => document.body.dataset.lastHitEffectCount)).toBe("2");
  await page.screenshot({ path: `output/playwright/double-hit-effects-${testInfo.project.name}.png`, fullPage: true });
});

test("the enemy uses contextual dashes and jumps", async ({ page }) => {
  await openDuel(page);

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiDashCount ?? "0")), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiJumpCount ?? "0")), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiMaxJumpHeight ?? "0")), { timeout: 1_000 })
    .toBeGreaterThan(10);
});

test("dual-saber enemy lowers jump attempts while keeping pressure active", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.9;
  });
  await openDuel(page);
  await page.getByRole("button", { name: "二刀流AI" }).click();
  await expect.poll(async () => page.evaluate(() => document.body.dataset.aiLoadout)).toBe("dual");

  await page.waitForTimeout(3_600);

  expect(Number(await page.evaluate(() => document.body.dataset.aiDashCount ?? "0"))).toBeGreaterThan(0);
  expect(Number(await page.evaluate(() => document.body.dataset.aiJumpCount ?? "0"))).toBe(0);
});

test("the enemy slowly faces the player while Q/F rotate only the player", async ({ page }) => {
  await openDuel(page);
  const initial = await page.evaluate(() => ({
    player: Number(document.body.dataset.playerAngle),
    ai: Number(document.body.dataset.aiAngle)
  }));

  await page.keyboard.down("W");
  await page.waitForTimeout(450);
  await page.keyboard.up("W");
  const afterMove = await page.evaluate(() => ({
    player: Number(document.body.dataset.playerAngle),
    ai: Number(document.body.dataset.aiAngle)
  }));
  expect(afterMove.player).toBeCloseTo(initial.player, 2);

  const positions = await page.evaluate(() => ({
    playerX: Number(document.body.dataset.playerX),
    playerY: Number(document.body.dataset.playerY),
    aiX: Number(document.body.dataset.aiX),
    aiY: Number(document.body.dataset.aiY)
  }));
  const targetAngle = Math.atan2(positions.playerY - positions.aiY, positions.playerX - positions.aiX);
  const initialError = Math.abs(normalizeAngleForTest(targetAngle - initial.ai));
  const afterMoveError = Math.abs(normalizeAngleForTest(targetAngle - afterMove.ai));
  expect(afterMoveError).toBeLessThan(initialError);
  expect(Math.abs(normalizeAngleForTest(afterMove.ai - initial.ai))).toBeLessThan(0.8);

  await page.keyboard.down("Q");
  await page.waitForTimeout(420);
  await page.keyboard.up("Q");
  const afterLeftTurn = Number(await page.evaluate(() => document.body.dataset.playerAngle));
  expect(afterLeftTurn).toBeLessThan(afterMove.player - 0.45);

  await page.keyboard.down("F");
  await page.waitForTimeout(420);
  await page.keyboard.up("F");
  const afterRightTurn = Number(await page.evaluate(() => document.body.dataset.playerAngle));
  expect(afterRightTurn).toBeGreaterThan(afterLeftTurn + 0.45);
});

function normalizeAngleForTest(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function makeFighter(partial: Pick<FighterState, "id" | "loadout" | "x" | "y" | "angle">): FighterState {
  return {
    ...partial,
    vx: 0,
    vy: 0,
    health: 100,
    jumpTimer: 0,
    jumpCooldown: 0,
    dashTimer: 0,
    dashCooldown: 0,
    hitCooldown: 0,
    parryTimer: 0
  };
}

test("Space dashes forward and enforces a cooldown", async ({ page }) => {
  await openDuel(page);
  const startX = Number(await page.evaluate(() => document.body.dataset.playerX));
  await page.keyboard.press("Space");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.playerDashing)).toBe("true");
  await expect.poll(async () => Number(await page.evaluate(() => document.body.dataset.playerX))).toBeGreaterThan(startX + 45);
  const cooldownBeforeRetry = Number(await page.evaluate(() => document.body.dataset.playerDashCooldown));
  await page.keyboard.press("Space");
  await page.waitForTimeout(50);
  const cooldownAfterRetry = Number(await page.evaluate(() => document.body.dataset.playerDashCooldown));
  expect(cooldownAfterRetry).toBeLessThan(cooldownBeforeRetry);
  expect(cooldownAfterRetry).toBeGreaterThan(0);
});

test("jump lifts the player, prevents attacking, and avoids incoming hits", async ({ page }) => {
  await openDuel(page);
  await expect(page.locator("#round-banner")).toContainText("DUEL");

  await page.keyboard.down("D");
  await page.waitForTimeout(1_100);
  await page.keyboard.up("D");
  const healthBeforeJump = Number(await page.evaluate(() => document.body.dataset.playerHealth ?? "100"));

  await pressJump(page);

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.playerJumpHeight ?? "0")), { timeout: 3_000 })
    .toBeGreaterThan(12);

  expect(await page.evaluate(() => document.body.dataset.playerState)).toBe("JUMP");
  expect(await page.evaluate(() => document.body.dataset.playerVisibleSaberCount)).toBe("1");
  const aiHealthDuringJump = Number(await page.evaluate(() => document.body.dataset.aiHealth ?? "100"));
  await page.waitForTimeout(280);
  expect(Number(await page.evaluate(() => document.body.dataset.aiHealth ?? "100"))).toBe(aiHealthDuringJump);
  expect(Number(await page.evaluate(() => document.body.dataset.playerHealth ?? "100"))).toBeGreaterThanOrEqual(healthBeforeJump);

  await expect
    .poll(async () => await page.evaluate(() => document.body.dataset.playerJumping), { timeout: 5_000 })
    .toBe("false");
});

test("fighter shadows are hidden on the ground and visible only while jumping", async ({ page }) => {
  await openDuel(page);
  expect(Number(await page.evaluate(() => document.body.dataset.playerShadowAlpha))).toBe(0);
  expect(Number(await page.evaluate(() => document.body.dataset.aiShadowAlpha))).toBe(0);
  expect(Number(await page.evaluate(() => document.body.dataset.playerMarkerAlpha))).toBe(0);

  await pressJump(page);

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.playerShadowAlpha ?? "0")), { timeout: 1_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.playerMarkerAlpha ?? "0")), { timeout: 1_000 })
    .toBeGreaterThan(0);

  await expect
    .poll(async () => await page.evaluate(() => document.body.dataset.playerJumping), { timeout: 8_000 })
    .toBe("false");
  expect(Number(await page.evaluate(() => document.body.dataset.playerShadowAlpha))).toBe(0);
  expect(Number(await page.evaluate(() => document.body.dataset.playerMarkerAlpha))).toBe(0);
});

test("long jump carries the player across the arena", async ({ page }) => {
  await openDuel(page);
  await page.keyboard.down("D");
  await page.waitForTimeout(120);
  const beforeJumpX = Number(await page.evaluate(() => document.body.dataset.playerX));
  await page.keyboard.press("E");
  await expect.poll(async () => page.evaluate(() => document.body.dataset.playerJumping)).toBe("true");

  await expect
    .poll(
      async () => page.evaluate((startX) => Number(document.body.dataset.playerX) - startX, beforeJumpX),
      { timeout: 3_000 }
    )
    .toBeGreaterThan(300);

  await page.keyboard.up("D");
});

test("lightsaber body hits require precise segment overlap", async ({ page }) => {
  await openDuel(page);
  await page.keyboard.down("W");
  await page.keyboard.down("D");
  await page.waitForTimeout(420);
  await page.keyboard.up("D");
  await page.keyboard.up("W");

  const state = await page.evaluate(() => ({
    health: Number(document.body.dataset.aiHealth),
    event: document.body.dataset.lastEvent
  }));
  expect(state.health).toBe(100);
  expect(state.event).not.toBe("body-hit");
});

test("mobile viewport keeps combat HUD and canvas visible", async ({ page }) => {
  await openDuel(page);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#controls-strip")).toBeVisible();
  await expect(page.locator("#player-health")).toBeVisible();
  await expect(page.locator("#ai-health")).toBeVisible();
  await expect(page.locator("#controls-strip")).not.toContainText("GUARD");
  await expect(page.locator("#controls-strip")).not.toContainText("SLASH");
  await expect(page.locator("#controls-strip")).toContainText("JUMP");
  await expect(page.locator("#controls-strip")).toContainText("DASH");
});

test("lightsaber contact collider repels both fighters", async ({ page }) => {
  await openDuel(page);
  await page.keyboard.down("D");

  await expect
    .poll(
      async () => Number(await page.evaluate(() => document.body.dataset.saberClashes ?? "0")),
      { timeout: 6_000 }
    )
    .toBeGreaterThan(0);

  await page.keyboard.up("D");

  const clashVelocity = await page.evaluate(() => ({
    player: Number(document.body.dataset.lastClashPlayerVx),
    ai: Number(document.body.dataset.lastClashAiVx)
  }));
  expect(clashVelocity.player).toBeLessThan(0);
  expect(clashVelocity.ai).toBeGreaterThan(0);
});

test("lightsaber collision remains active without requiring Slash", async ({ page }) => {
  await openDuel(page);
  await page.keyboard.down("D");

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.saberClashes ?? "0")), { timeout: 7_000 })
    .toBeGreaterThan(0);

  await page.keyboard.up("D");
  expect(await page.evaluate(() => document.body.dataset.playerState)).not.toBe("SLASH");
});
