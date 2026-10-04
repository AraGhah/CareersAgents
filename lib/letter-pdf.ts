import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// Letter-size page laid out like the cover letter template: the name in bold, the
// contact lines small and grey, then the letter in a plain sans-serif. The body
// shrinks a little before it spills to a second page, because the guide asks for
// one page.

const PAGE = { width: 612, height: 792 };
const MARGIN = { x: 64, top: 60, bottom: 56 };
const BODY_SIZES = [11, 10.5, 10, 9.5];

const INK = rgb(0.09, 0.13, 0.2);
const MUTED = rgb(0.36, 0.41, 0.47);

type Fonts = { regular: PDFFont; bold: PDFFont };

type Op = { page: number; y: number; text: string; font: PDFFont; size: number; color: ReturnType<typeof rgb> };

type Block =
  | { kind: "name"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "gap"; size: "header" | "body" }
  | { kind: "body"; text: string };

/** The header is everything before the first blank line: the name, then the contact lines. */
function parseBlocks(letter: string): Block[] {
  const lines = letter.split("\n");
  const firstBlank = lines.findIndex((l) => l.trim() === "");
  const headerEnd = firstBlank === -1 ? lines.length : firstBlank;

  const blocks: Block[] = [];
  lines.forEach((line, i) => {
    if (i < headerEnd) {
      blocks.push(i === 0 ? { kind: "name", text: line } : { kind: "contact", text: line });
    } else if (i === headerEnd) {
      blocks.push({ kind: "gap", size: "header" });
    } else if (line.trim() === "") {
      blocks.push({ kind: "gap", size: "body" });
    } else {
      blocks.push({ kind: "body", text: line });
    }
  });
  return blocks;
}

/** Drops characters the built-in font cannot draw instead of letting pdf-lib throw. */
export function drawable(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.replace(/[   ]/g, " ")]
    .map((ch) => (supported.has(ch.codePointAt(0) ?? 0) ? ch : "?"))
    .join("");
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = drawable(text, font).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function layout(blocks: Block[], fonts: Fonts, bodySize: number): { ops: Op[]; pages: number } {
  const maxWidth = PAGE.width - MARGIN.x * 2;
  const bodyLead = bodySize * 1.42;
  const ops: Op[] = [];
  let page = 0;
  let y = PAGE.height - MARGIN.top;

  const place = (text: string, font: PDFFont, size: number, color: Op["color"], lead: number) => {
    if (y - lead < MARGIN.bottom) {
      page += 1;
      y = PAGE.height - MARGIN.top;
    }
    y -= lead;
    ops.push({ page, y, text, font, size, color });
  };

  for (const block of blocks) {
    if (block.kind === "name") {
      place(drawable(block.text, fonts.bold), fonts.bold, 16, INK, 19);
    } else if (block.kind === "contact") {
      for (const line of wrap(block.text, fonts.regular, 9, maxWidth)) {
        place(line, fonts.regular, 9, MUTED, 12.5);
      }
    } else if (block.kind === "gap") {
      y -= block.size === "header" ? 16 : bodySize * 0.75;
    } else {
      for (const line of wrap(block.text, fonts.regular, bodySize, maxWidth)) {
        place(line, fonts.regular, bodySize, INK, bodyLead);
      }
    }
  }
  return { ops, pages: page + 1 };
}

/**
 * Renders the letter text (header block, blank line, body) to PDF bytes. Tries
 * the larger body sizes first and keeps the first one that fits on one page;
 * when none does, it uses the smallest and reports the page count so the
 * checklist can flag it.
 */
export async function renderLetterPdf(letter: string): Promise<{ bytes: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const blocks = parseBlocks(letter);

  let result = layout(blocks, fonts, BODY_SIZES[0]);
  for (const size of BODY_SIZES.slice(1)) {
    if (result.pages === 1) break;
    result = layout(blocks, fonts, size);
  }

  const pages = Array.from({ length: result.pages }, () => doc.addPage([PAGE.width, PAGE.height]));
  for (const op of result.ops) {
    pages[op.page].drawText(op.text, { x: MARGIN.x, y: op.y, size: op.size, font: op.font, color: op.color });
  }

  return { bytes: await doc.save(), pages: result.pages };
}
