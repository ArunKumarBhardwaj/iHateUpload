import { htmlToBlocks, type Block } from "../word-to-pdf/model";

export async function htmlToDoc(html: string): Promise<{ blocks: Block[] }> {
  return { blocks: htmlToBlocks(html) };
}
