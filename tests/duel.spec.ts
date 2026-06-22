import { expect, test } from "@playwright/test";

test("boots into a playable lightsaber duel with dash and without a Slash control", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#round-banner")).toContainText("DUEL");
  await expect(page.locator("canvas")).toBeVisible();
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

  const assetsOk = await page.evaluate(async () => {
    const checks = await Promise.all([
      fetch("/assets/generated/player_topdown_cutout.png"),
      fetch("/assets/generated/enemy_topdown_cutout.png"),
      fetch("/assets/generated/player_jump_sheet.png"),
      fetch("/assets/generated/enemy_jump_sheet.png")
    ]);
    return checks.map((response) => response.ok);
  });
  expect(assetsOk).toEqual([true, true, true, true]);

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

test("the enemy uses contextual dashes and jumps", async ({ page }) => {
  await page.goto("/");

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiDashCount ?? "0")), { timeout: 4_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiJumpCount ?? "0")), { timeout: 8_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.aiMaxJumpHeight ?? "0")), { timeout: 1_000 })
    .toBeGreaterThan(10);
});

test("the enemy slowly faces the player while Q/F rotate only the player", async ({ page }) => {
  await page.goto("/");
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
  await page.waitForTimeout(300);
  await page.keyboard.up("Q");
  const afterLeftTurn = Number(await page.evaluate(() => document.body.dataset.playerAngle));
  expect(afterLeftTurn).toBeLessThan(afterMove.player - 0.5);

  await page.keyboard.down("F");
  await page.waitForTimeout(300);
  await page.keyboard.up("F");
  const afterRightTurn = Number(await page.evaluate(() => document.body.dataset.playerAngle));
  expect(afterRightTurn).toBeGreaterThan(afterLeftTurn + 0.5);
});

function normalizeAngleForTest(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

test("Space dashes forward and enforces a cooldown", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
  await expect(page.locator("#round-banner")).toContainText("DUEL");

  await page.keyboard.down("D");
  await page.waitForTimeout(1_100);
  await page.keyboard.up("D");
  const healthBeforeJump = Number(await page.evaluate(() => document.body.dataset.playerHealth ?? "100"));

  await page.keyboard.press("E");

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.playerJumpHeight ?? "0")), { timeout: 1_000 })
    .toBeGreaterThan(12);

  expect(await page.evaluate(() => document.body.dataset.playerState)).toBe("JUMP");
  const aiHealthDuringJump = Number(await page.evaluate(() => document.body.dataset.aiHealth ?? "100"));
  await page.waitForTimeout(280);
  expect(Number(await page.evaluate(() => document.body.dataset.aiHealth ?? "100"))).toBe(aiHealthDuringJump);
  expect(Number(await page.evaluate(() => document.body.dataset.playerHealth ?? "100"))).toBeGreaterThanOrEqual(healthBeforeJump);

  await expect
    .poll(async () => await page.evaluate(() => document.body.dataset.playerJumping), { timeout: 5_000 })
    .toBe("false");
});

test("long jump carries the player across the arena", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.down("D");
  await page.waitForTimeout(650);
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await page.keyboard.down("D");
  await page.waitForTimeout(1_200);

  expect(Number(await page.evaluate(() => document.body.dataset.saberClashes ?? "0"))).toBe(0);

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
  await page.goto("/");
  await page.keyboard.down("D");

  await expect
    .poll(async () => Number(await page.evaluate(() => document.body.dataset.saberClashes ?? "0")), { timeout: 7_000 })
    .toBeGreaterThan(0);

  await page.keyboard.up("D");
  expect(await page.evaluate(() => document.body.dataset.playerState)).not.toBe("SLASH");
});
