// Custom 100 x 150 mm, portrait forced, fill the sheet.
export default async function sizeCustom(page) {
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.locator("#size-w").fill("100");
  await page.locator("#size-h").fill("150");
  await page.getByRole("button", { name: "Portrait", exact: true }).click();
  await page.getByRole("button", { name: "Fill sheet" }).click();
}
