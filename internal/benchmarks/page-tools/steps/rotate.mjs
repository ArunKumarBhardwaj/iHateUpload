// Page 1 right, page 3 left, pages 4+5 selected then right; page 6 untouched. Mirror left-right on page range "6".
export default async function rotate(page) {
  await page.getByRole("button", { name: "Turn page 1 right" }).click();
  await page.getByRole("button", { name: "Turn page 3 left" }).click();
  await page.getByRole("button", { name: /^Page 4/ }).click();
  await page.getByRole("button", { name: /^Page 5/ }).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Rotate selected right" }).click();
  await page.getByRole("button", { name: "Turn page 6 180 degrees" }).click();
  await page.waitForTimeout(500);
}
