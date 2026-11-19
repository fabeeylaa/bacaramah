import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const ALLOWED_EXT = ['.pdf', '.docx'];

function tidy(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// gabungkan baris PDF yang terpotong di tengah kalimat
function reflow(text) {
  return text
    .replace(/([a-z0-9,)])-\n(?=[a-z])/g, '$1-')
    .replace(/([^.!?:;\n])\n(?=[a-z])/g, '$1 ');
}

async function fromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text).join('\n\n');
  } finally {
    await parser.destroy();
  }
}

async function fromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const raw = ext === '.pdf' ? await fromPdf(file.buffer) : await fromDocx(file.buffer);
  const text = tidy(raw);
  return {
    text: ext === '.pdf' ? reflow(text) : text,
    source: ext === '.pdf' ? 'pdf' : 'docx',
  };
}