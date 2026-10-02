import type { Page } from '@playwright/test';
import { toScreen } from '../flows/diagrams';

// Medición de FPS compartida por las pruebas de rendimiento (003, 004 y 005).

export type FrameStats = { fps: number; p95Ms: number; frames: number };

/** Cuenta los frames del navegador mientras `interact` mueve la vista. */
export async function measureFrames(
  page: Page,
  interact: () => Promise<void>,
): Promise<FrameStats> {
  await page.evaluate(() => {
    const times: number[] = [];
    const w = window as unknown as { __frames: number[]; __measuring: boolean };
    w.__frames = times;
    w.__measuring = true;
    const tick = (time: number) => {
      times.push(time);
      if (w.__measuring) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await interact();
  const times = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __measuring: boolean };
    w.__measuring = false;
    return w.__frames;
  });
  const intervals = times.slice(1).map((time, i) => time - times[i]!);
  const sorted = [...intervals].sort((a, b) => a - b);
  const seconds = (times.at(-1)! - times[0]!) / 1000;
  return {
    fps: Math.round((intervals.length / seconds) * 10) / 10,
    p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10,
    frames: intervals.length,
  };
}

/** Zoom y desplazamiento continuos sobre el centro del diagrama de 100 zonas. */
export async function measureNavigation(page: Page) {
  const middle = await toScreen(page, { x: 1500, y: 1000 });
  await page.mouse.move(middle.x, middle.y);
  const zoom = await measureFrames(page, async () => {
    for (let i = 0; i < 90; i++) {
      await page.mouse.wheel(0, i < 45 ? -120 : 120);
      await page.waitForTimeout(16);
    }
  });
  const pan = await measureFrames(page, async () => {
    await page.mouse.down();
    for (let i = 0; i < 120; i++) {
      await page.mouse.move(middle.x + 200 * Math.sin(i / 10), middle.y + 100 * Math.cos(i / 10));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  });
  return { zoom, pan };
}
