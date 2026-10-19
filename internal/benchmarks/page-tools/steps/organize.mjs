// Drag page 1 after page 3, keyboard-move page 6 to the front (Alt+Left x5), rotate position 2 right, duplicate position 4, delete position 5, blank after position 1.
export default async function organize(page) {
  const grid = page.getByRole("list", { name: "Pages in the new order" });
  const items = grid.locator("li");
  const card = (n) => items.nth(n - 1);
  // drag with the grip handle: page 1 -> right half of card 3
  const h = await card(1).locator("[data-handle]").boundingBox();
  const t = await card(3).boundingBox();
  await page.mouse.move(h.x + 8, h.y + 8);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width - 6, t.y + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // order now: 2 3 1 4 5 6
  await card(6).getByRole("button", { name: /^Page 6/ }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForTimeout(300);
  // order now: 6 2 3 1 4 5
  await page.getByRole("button", { name: "Rotate position 2 right" }).click();
  await page.getByRole("button", { name: "Duplicate position 4" }).click();
  // order: 6 2 3 1 1' 4 5 ; delete position 6 (page 4)
  await page.getByRole("button", { name: "Delete position 6" }).click();
  await page.getByRole("button", { name: "Insert a blank page after position 1" }).click();
  await page.waitForTimeout(500);
}
