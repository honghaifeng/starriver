'use strict';
// 附件文本抽取：pdf / docx / doc / rtf / txt / md / csv / json / html
// 原则：抽不出来也要保住文件本身，返回 { text:'', warn:'...' }，不抛错阻断上传。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 解析 PDF 靠 pypdf，而「系统自带的 python3」往往没装它。
// 所以候选里既有解释器，也要允许调用方用 CB_PYTHON 指定一个装好 pypdf 的。
// 少这一个口子，服务器上就会静默降级成「附件抽不出正文」——文件还在，但模型读不到。
const PY_CANDIDATES = [
  process.env.CB_PYTHON,               // 显式指定优先，CI / venv 里用
  path.join(__dirname, '..', '.venv', 'bin', 'python'),   // 项目内 venv（惯例位置一）
  path.join(__dirname, '..', 'venv', 'bin', 'python'),    // 项目内 venv（惯例位置二）
  'python3',                           // PATH 里的 python3
  '/usr/bin/python3',                  // macOS / 多数 Linux 自带
  'python'
].filter(Boolean);

function tryExec(cmd, args, opts) {
  try {
    return { ok: true, out: execFileSync(cmd, args, Object.assign({ maxBuffer: 40 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }, opts || {})).toString('utf8') };
  } catch (e) { return { ok: false, out: '', err: e }; }
}

const PDF_PY = `
import sys
try:
    from pypdf import PdfReader
except Exception:
    print('', end='')
    sys.exit(3)
r = PdfReader(sys.argv[1])
out = []
for i, p in enumerate(r.pages):
    try:
        t = p.extract_text() or ''
    except Exception:
        t = ''
    if t.strip():
        out.append(t)
print('\\n\\n'.join(out), end='')
`;

const DOCX_PY = `
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
xml = z.read('word/document.xml').decode('utf-8', 'ignore')
xml = re.sub(r'</w:p>', '\\n', xml)
xml = re.sub(r'<w:tab[^>]*/>', '\\t', xml)
xml = re.sub(r'<[^>]+>', '', xml)
import html
print(html.unescape(xml), end='')
`;

function extractPdf(file) {
  const viaPy = PY_CANDIDATES.map(py => tryExec(py, ['-c', PDF_PY, file])).find(r => r.ok && r.out.trim());
  if (viaPy) return { text: viaPy.out };
  const viaTxt = tryExec('/usr/bin/pdftotext', ['-layout', file, '-']);
  if (viaTxt.ok && viaTxt.out.trim()) return { text: viaTxt.out };
  return { text: '', warn: 'PDF 正文未抽取（缺解析器），文件仍可作为附件保留；修复：python3 -m pip install pypdf，或用 CB_PYTHON 指定装好 pypdf 的解释器' };
}

function extractDocx(file) {
  const viaPy = PY_CANDIDATES.map(py => tryExec(py, ['-c', DOCX_PY, file])).find(r => r.ok && r.out.trim());
  if (viaPy) return { text: viaPy.out };
  const viaTu = tryExec('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file]);
  if (viaTu.ok && viaTu.out.trim()) return { text: viaTu.out };
  return { text: '', warn: 'Word 正文未抽取，文件仍可作为附件保留' };
}

function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yml', '.yaml', '.html', '.htm'].includes(ext)) {
      let t = fs.readFileSync(file, 'utf8');
      if (ext === '.html' || ext === '.htm') t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      return { text: t };
    }
    if (ext === '.pdf') return extractPdf(file);
    if (ext === '.docx') return extractDocx(file);
    if (ext === '.doc' || ext === '.rtf' || ext === '.odt') {
      const r = tryExec('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file]);
      if (r.ok && r.out.trim()) return { text: r.out };
      return { text: '', warn: '文档正文未抽取，文件仍可作为附件保留' };
    }
    return { text: '', warn: '不支持的文本类型（' + (ext || '无扩展名') + '），仅保留文件' };
  } catch (e) {
    return { text: '', warn: '读取失败：' + e.message };
  }
}

module.exports = { extractText };
