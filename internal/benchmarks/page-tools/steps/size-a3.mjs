export default async function sizeA3(page) {
  await page.getByRole("button", { name: "A3", exact: true }).click();
}
