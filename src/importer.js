"use strict";
// 协议文档导入（CSV 版）：把团队现成的字段表粘进来，一键生成协议配置草稿。
// 支持的列（中英文表头都认，顺序任意，多余列忽略）：
// 命令 | 命令名称 | 字段 | 类型 | 大小端 | 倍率 | 偏移 | 单位 | 枚举 | 位定义 | 字节数
// 枚举/位定义写法：0=关;1=开（分隔符 ; 或 |，等号也可用 :）
// Excel 里另存为 CSV（UTF-8）后把内容粘进工具即可。

function splitCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === "," || ch === "\t") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const COL_ALIAS = {
  command: ["command", "命令", "命令字", "cmd"], commandName: ["command_name", "命令名称", "命令名"],
  field: ["field", "字段", "字段名", "名称"], type: ["type", "类型", "数据类型"],
  endian: ["endian", "大小端", "字节序"], scale: ["scale", "倍率", "系数"],
  offset: ["offset", "偏移", "偏移量"], unit: ["unit", "单位"],
  choices: ["choices", "枚举", "枚举值"], bits: ["bits", "位定义", "状态位"],
  size: ["size", "字节数", "长度"],
};
const TYPE_ALIAS = {
  u8: "uint8", uint8: "uint8", "unsigned char": "uint8", i8: "int8", int8: "int8", char: "int8",
  u16: "uint16", uint16: "uint16", ushort: "uint16", i16: "int16", int16: "int16", short: "int16",
  u32: "uint32", uint32: "uint32", uint: "uint32", i32: "int32", int32: "int32", int: "int32",
  float: "float32", float32: "float32", f32: "float32", enum: "enum", "枚举": "enum",
  bits: "bits", "位": "bits", "状态位": "bits", bytes: "bytes", "字节数组": "bytes",
};

function parsePairs(text) {
  if (!text) return undefined;
  const obj = {};
  for (const part of String(text).split(/[;|]/)) {
    const m = part.trim().match(/^([^=:\s]+)\s*[=:]\s*(.+)$/);
    if (m) obj[m[1].trim()] = m[2].trim();
  }
  return Object.keys(obj).length ? obj : undefined;
}

function importCSV(text, options = {}) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) throw new Error("CSV 至少要有表头和一行字段");
  const header = splitCSVLine(lines[0]).map(h => h.toLowerCase());
  const colIdx = {};
  for (const [key, aliases] of Object.entries(COL_ALIAS)) {
    const idx = header.findIndex(h => aliases.includes(h));
    if (idx >= 0) colIdx[key] = idx;
  }
  if (colIdx.command === undefined || colIdx.field === undefined || colIdx.type === undefined) {
    throw new Error("表头里没找到必需的列：命令、字段、类型（中英文都认）");
  }
  const get = (cells, key) => (colIdx[key] !== undefined ? (cells[colIdx[key]] || "") : "");
  const commands = {};
  const order = [];
  for (const line of lines.slice(1)) {
    const cells = splitCSVLine(line);
    let cmdKey = get(cells, "command").trim();
    if (!cmdKey) continue;
    if (!/^0x/i.test(cmdKey)) cmdKey = "0x" + parseInt(cmdKey, 10).toString(16).toUpperCase().padStart(2, "0");
    else cmdKey = "0x" + cmdKey.slice(2).toUpperCase();
    if (!commands[cmdKey]) { commands[cmdKey] = { name: get(cells, "commandName") || cmdKey, fields: [] }; order.push(cmdKey); }
    const rawType = get(cells, "type").trim().toLowerCase();
    const type = TYPE_ALIAS[rawType];
    if (!type) throw new Error(`不认识的类型写法：${get(cells, "type")}（字段 ${get(cells, "field")}）`);
    const field = { name: get(cells, "field").trim(), type };
    const endian = get(cells, "endian").trim().toLowerCase();
    if (type === "uint16" || type === "int16" || type === "uint32" || type === "int32" || type === "float32") {
      field.endian = (endian.includes("big") || endian.includes("大")) ? "big" : "little";
    }
    const scale = get(cells, "scale"); if (scale !== "" && Number(scale) !== 1) field.scale = Number(scale);
    const off = get(cells, "offset"); if (off !== "" && Number(off) !== 0) field.offset = Number(off);
    const unit = get(cells, "unit"); if (unit) field.unit = unit;
    if (type === "enum") { const c = parsePairs(get(cells, "choices")); if (c) field.choices = c; }
    if (type === "bits") { const b = parsePairs(get(cells, "bits")); if (b) field.bits = b; }
    if (type === "bytes") { const s = parseInt(get(cells, "size"), 10); field.size = Number.isFinite(s) && s > 0 ? s : 1; }
    commands[cmdKey].fields.push(field);
  }
  if (order.length === 0) throw new Error("没有读到任何字段行");
  const headerBytes = (options.header || "AA 55").toString().trim().split(/[\s,]+/).filter(Boolean).map(h => parseInt(h, 16));
  return {
    name: options.name || "导入的协议",
    frame: {
      header: headerBytes,
      lengthField: { offset: headerBytes.length, size: 1 },
      checksum: { type: options.checksum || "crc16_modbus", size: 2, endian: "little" },
    },
    commandField: { offset: headerBytes.length + 1, size: 1 },
    commands,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { importCSV };
}
