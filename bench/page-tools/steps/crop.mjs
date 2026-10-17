export default async function (page) {
  await page.getByRole("button", { name: "Each page its own crop" }).click();
  await page.locator("#crop-top").fill("40");
  await page.getByRole("button", { name: /^Page 3/ }).click();
  await page.waitForTimeout(300);
  await page.locator("#crop-left").fill("100");
  await page.getByRole("button", { name: /^Page 2/ }).click();
  await page.waitForTimeout(800);
}
