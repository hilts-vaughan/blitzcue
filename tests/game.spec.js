import { test, expect } from '@playwright/test';

test('a daily run survives refresh, cycles skipped prompts, rejects invalid answers, and appears in server results', async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const aliceId = `alice_${suffix}`;
  const bobId = `bob_${suffix}`;
  const alice = await browser.newContext();
  const page = await alice.newPage();
  await page.goto(`/.proxy/?standalone=1&player=${aliceId}`);
  await expect(page.getByRole('button', { name: /play today/i })).toBeVisible();
  const letter = (await page.locator('.letter').textContent()).trim();
  await page.getByRole('button', { name: /play today/i }).click();
  await expect(page.locator('.prompt-count')).toHaveText('Category 1 of 10');
  const firstPrompt = await page.locator('.prompt-card h2').textContent();
  const timeBeforeReload = await page.locator('#timer').textContent();
  await page.reload();
  await expect(page.locator('.prompt-card h2')).toHaveText(firstPrompt);
  const timeAfterReload = await page.locator('#timer').textContent();
  expect(timeAfterReload <= timeBeforeReload).toBeTruthy();

  await page.locator('#answer').fill('wrong answer');
  await page.getByRole('button', { name: /confirm answer/i }).click();
  await expect(page.getByRole('alert')).toContainText(`start with ${letter}`);
  await expect(page.locator('.prompt-card h2')).toHaveText(firstPrompt);

  await page.getByRole('button', { name: /skip for now/i }).click();
  await expect(page.locator('.prompt-count')).toHaveText('Category 2 of 10');
  for (let index = 1; index < 10; index++) {
    await page.locator('#answer').fill(`${letter}lausible${index}`);
    await page.getByRole('button', { name: /confirm answer/i }).click();
    await expect(page.locator('.game-meta .muted')).toHaveText(`${index} of 10 answered`);
  }
  await expect(page.locator('.prompt-card h2')).toHaveText(firstPrompt);
  await page.locator('#answer').fill(`${letter}lausible0`);
  await page.getByRole('button', { name: /confirm answer/i }).click();
  await expect(page.getByRole('heading', { name: /nicely played/i })).toBeVisible();
  await expect(page.locator('.results-card .blocks .block')).toHaveCount(10);
  await expect(page.locator('#players')).toContainText(aliceId.replace('_', ' '));
  await expect(page.locator('.results-head')).not.toContainText('score');

  const bob = await browser.newContext();
  const bobPage = await bob.newPage();
  await bobPage.goto(`/?standalone=1&player=${bobId}`);
  await bobPage.getByRole('button', { name: /play today/i }).click();
  await bobPage.locator('#answer').fill(`${letter}lain`);
  await bobPage.getByRole('button', { name: /confirm answer/i }).click();
  await page.getByRole('button', { name: /refresh server results/i }).click();
  await expect(page.locator('#players')).toContainText(bobId.replace('_', ' '));
  await expect(page.locator('#players')).toContainText('Playing now');
  await bob.close();
  await alice.close();
});
