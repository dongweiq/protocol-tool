"use strict";
// Excel（.xlsx）文件直接导入：浏览器里直接选 .xlsx 文件读出字段表生成配置，不用再另存为 CSV。
// 零外部依赖：xlsx 本质是 zip，
//  - 解 zip：读中央目录定位文件，stored 直接取、deflate 用 DecompressionStream 解（Node 下用 zlib 兜底）；
//  - 读表：sharedStrings.xml + 第一个工作表 sheet XML，用纯字符串扫描解析（不依赖 DOMParser，
//    浏览器与 Node 走同一份代码，测试可直接跑）。
// 解析结果是与 CSV 导入相同的行数据结构（字符串二维数组），再复用 importer.js 的 rowsToConfig 生成配置。

function xlsxInflateRaw(bytes) {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer().then(buf => new Uint8Array(buf));
  }
  if (typeof require === "function") {
    return Promise.resolve(require("zlib").inflateRawSync(Buffer.from(bytes)));
  }
  return Promise.reject(new Error("当前环境不支持解压 xlsx（需要 DecompressionStream）"));
}

// 读 zip 中央目录：{ 文件名: { method, compressedSize, localHeaderOffset } }
function xlsxReadCentralDirectory(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 zip / xlsx 文件（找不到中央目录）");
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const entries = {};
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) throw new Error("xlsx 中央目录损坏");
    const method = view.getUint16(off + 10, true);
    const compressedSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localHeaderOffset = view.getUint32(off + 42, true);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nameLen));
    entries[name] = { method, compressedSize, localHeaderOffset };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function xlsxReadEntry(buf, entry) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const off = entry.localHeaderOffset;
  if (view.getUint32(off, true) !== 0x04034b50) throw new Error("xlsx 本地文件头损坏");
  const nameLen = view.getUint16(off + 26, true);
  const extraLen = view.getUint16(off + 28, true);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return xlsxInflateRaw(raw);
  throw new Error("xlsx 里有不支持的压缩方式（method=" + entry.method + "）");
}

function xlsxUnescapeXml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function xlsxAttr(tag, name) {
  const m = tag.match(new RegExp("\\b" + name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : "";
}

// sharedStrings.xml -> 字符串数组
function xlsxParseSharedStrings(xml) {
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let text = "";
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tre.exec(m[1]))) text += xlsxUnescapeXml(t[1]);
    out.push(text);
  }
  return out;
}

function xlsxColToIndex(ref) {
  const letters = ref.replace(/[0-9]+$/, "").toUpperCase();
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

// 工作表 XML -> 行数据（字符串二维数组，空单元格补 ""，全空行去掉）
function xlsxParseSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const ref = xlsxAttr(attrs, "r");
      const col = ref ? xlsxColToIndex(ref) : row.length;
      while (row.length < col) row.push("");
      const type = xlsxAttr(attrs, "t");
      const inner = cm[2] || "";
      let value = "";
      if (type === "s") {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        const idx = vm ? parseInt(vm[1], 10) : NaN;
        value = Number.isFinite(idx) ? (sharedStrings[idx] || "") : "";
      } else if (type === "inlineStr") {
        const tm = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = tm ? xlsxUnescapeXml(tm[1]) : "";
      } else {
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        value = vm ? xlsxUnescapeXml(vm[1]) : "";
      }
      row[col] = value;
    }
    if (row.some(c => String(c).trim() !== "")) rows.push(row);
  }
  return rows;
}

// 找第一个工作表的文件名：workbook.xml + rels，失败时退回 xl/worksheets/sheet1.xml
async function xlsxFirstSheetName(buf, entries) {
  try {
    if (!entries["xl/workbook.xml"] || !entries["xl/_rels/workbook.xml.rels"]) return "xl/worksheets/sheet1.xml";
    const wb = new TextDecoder("utf-8").decode(await xlsxReadEntry(buf, entries["xl/workbook.xml"]));
    const sheetM = wb.match(/<sheet\b[^>]*>/);
    if (!sheetM) return "xl/worksheets/sheet1.xml";
    const rid = xlsxAttr(sheetM[0], "r:id") || xlsxAttr(sheetM[0], "id");
    const rels = new TextDecoder("utf-8").decode(await xlsxReadEntry(buf, entries["xl/_rels/workbook.xml.rels"]));
    const relRe = /<Relationship\b[^>]*>/g;
    let rm;
    while ((rm = relRe.exec(rels))) {
      if (xlsxAttr(rm[0], "Id") === rid) {
        const target = xlsxAttr(rm[0], "Target");
        if (target) return target.startsWith("xl/") ? target : "xl/" + target.replace(/^\//, "");
      }
    }
  } catch (e) { /* 走兜底 */ }
  return "xl/worksheets/sheet1.xml";
}

// .xlsx 文件内容（ArrayBuffer / Uint8Array）-> 行数据
async function parseXlsx(data) {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("不是 xlsx 文件（文件头不是 zip）");
  const entries = xlsxReadCentralDirectory(buf);
  let sharedStrings = [];
  if (entries["xl/sharedStrings.xml"]) {
    const xml = new TextDecoder("utf-8").decode(await xlsxReadEntry(buf, entries["xl/sharedStrings.xml"]));
    sharedStrings = xlsxParseSharedStrings(xml);
  }
  const sheetName = await xlsxFirstSheetName(buf, entries);
  if (!entries[sheetName]) throw new Error("xlsx 里找不到工作表：" + sheetName);
  const sheetXml = new TextDecoder("utf-8").decode(await xlsxReadEntry(buf, entries[sheetName]));
  const rows = xlsxParseSheetXml(sheetXml, sharedStrings);
  if (rows.length < 2) throw new Error("工作表里至少要有表头和一行字段");
  return rows;
}

// .xlsx 文件内容 -> 协议配置（与 CSV 导入同一套行数据结构、同一套生成逻辑）
async function importXlsx(data, options = {}) {
  const rows = await parseXlsx(data);
  const rowsToConfig = (typeof globalThis !== "undefined" && typeof globalThis.rowsToConfig === "function")
    ? globalThis.rowsToConfig
    : require("./importer.js").rowsToConfig;
  return rowsToConfig(rows, options);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseXlsx, importXlsx, xlsxParseSheetXml, xlsxParseSharedStrings };
}
