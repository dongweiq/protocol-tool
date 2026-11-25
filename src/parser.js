"use strict";
// 协议解析引擎 v1：读配置 -> 把原始字节拆成字段。浏览器和 Node 都能跑。

function crc16Modbus(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return crc;
}

function checksumValue(type, bytes) {
  if (type === "crc16_modbus") return crc16Modbus(bytes);
  if (type === "sum8") return bytes.reduce((a, b) => (a + b) & 0xFF, 0);
  if (type === "xor8") return bytes.reduce((a, b) => a ^ b, 0);
  return null;
}

const TYPE_SIZE = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, enum: 1, bits: 1 };

function readRaw(bytes, offset, field) {
  const size = field.type === "bytes" ? field.size : TYPE_SIZE[field.type];
  const slice = bytes.slice(offset, offset + size);
  if (slice.length < size) return { size, raw: null };
  if (field.type === "bytes") return { size, raw: slice };
  let v = 0;
  const ordered = field.endian === "big" ? slice : [...slice].reverse();
  for (const b of ordered) v = v * 256 + b;
  if (field.type === "float32") {
    const buf = new DataView(new Uint8Array(slice).buffer);
    return { size, raw: buf.getFloat32(0, field.endian !== "big") };
  }
  const bits = size * 8;
  if (field.type.startsWith("int") && v >= 2 ** (bits - 1)) v -= 2 ** bits;
  return { size, raw: v };
}

function parseFrame(config, bytes) {
  const out = { ok: false, errors: [], fields: [], raw: [...bytes] };
  const frame = config.frame;
  // 帧头
  const header = frame.header || [];
  for (let i = 0; i < header.length; i++) {
    if (bytes[i] !== header[i]) { out.errors.push("帧头不匹配"); return out; }
  }
  // 长度字段：值 = 命令字段起到校验前的字节数
  const cs = frame.checksum || { type: "none", size: 0 };
  if (frame.lengthField) {
    const lf = frame.lengthField;
    let declared = 0;
    for (let i = 0; i < lf.size; i++) declared = declared * 256 + bytes[lf.offset + i];
    const actual = bytes.length - cs.size - config.commandField.offset;
    if (declared !== actual) out.errors.push(`长度不符：声明 ${declared}，实际 ${actual}`);
  }
  // 校验
  if (cs.type && cs.type !== "none") {
    const body = bytes.slice(0, bytes.length - cs.size);
    const calc = checksumValue(cs.type, body);
    let recv = 0;
    const tail = bytes.slice(bytes.length - cs.size);
    const ordered = cs.endian === "big" ? tail : [...tail].reverse();
    for (const b of ordered) recv = recv * 256 + b;
    out.checksumOk = calc === recv;
    if (!out.checksumOk) out.errors.push(`校验失败：算出 0x${calc.toString(16)}, 帧内 0x${recv.toString(16)}`);
  } else {
    out.checksumOk = true;
  }
  // 命令分支（switch-on）
  const cf = config.commandField;
  let cmdVal = 0;
  for (let i = 0; i < cf.size; i++) cmdVal = cmdVal * 256 + bytes[cf.offset + i];
  const cmdKey = "0x" + cmdVal.toString(16).toUpperCase().padStart(2, "0");
  const cmd = (config.commands || {})[cmdKey];
  out.command = cmdKey;
  if (!cmd) { out.errors.push(`未定义的命令 ${cmdKey}`); return out; }
  out.commandName = cmd.name;
  // 字段顺序解析
  let offset = cf.offset + cf.size;
  const limit = bytes.length - cs.size;
  for (const field of cmd.fields) {
    if (offset >= limit && field.type !== "bytes") break;
    const { size, raw } = readRaw(bytes, offset, field);
    if (raw === null) { out.errors.push(`字段 ${field.name} 超出帧长`); break; }
    const item = { name: field.name, offset, size, raw };
    if (field.type === "bits") {
      item.value = Object.entries(field.bits || {}).filter(([bit]) => raw & (1 << Number(bit))).map(([, label]) => label);
    } else if (field.type === "enum") {
      item.value = (field.choices || {})[String(raw)] ?? raw;
    } else if (field.type === "bytes") {
      item.value = raw.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    } else {
      item.value = raw * (field.scale ?? 1) + (field.offset ?? 0);
    }
    if (field.unit) item.unit = field.unit;
    out.fields.push(item);
    offset += size;
  }
  out.ok = out.errors.length === 0;
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseFrame, crc16Modbus };
}
