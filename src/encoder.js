"use strict";
// 拼帧编码器：解析的逆操作。按配置 + 命令 + 字段值 -> 生成完整帧（含长度与校验）
// 用途：工具里按字段发命令、模拟设备造数据、自动化测试生成用例。

function encCrc16Modbus(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
  }
  return crc;
}

function encChecksum(type, bytes) {
  if (type === "crc16_modbus") return encCrc16Modbus(bytes);
  if (type === "sum8") return bytes.reduce((a, b) => (a + b) & 0xFF, 0);
  if (type === "xor8") return bytes.reduce((a, b) => a ^ b, 0);
  return 0;
}

const ENC_TYPE_SIZE = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, enum: 1, bits: 1 };

function writeUint(buf, offset, value, size, bigEndian) {
  let v = value >>> 0;
  const bytes = [];
  for (let i = 0; i < size; i++) { bytes.unshift(v & 0xFF); v >>>= 8; }
  const ordered = bigEndian ? bytes : bytes.reverse();
  ordered.forEach((b, i) => { buf[offset + i] = b; });
}

function fieldRawValue(field, value) {
  if (field.type === "enum") {
    if (typeof value === "string" && field.choices) {
      const hit = Object.entries(field.choices).find(([, label]) => label === value);
      if (hit) return parseInt(hit[0], 10);
    }
    return Number(value) || 0;
  }
  if (field.type === "bits") {
    if (Array.isArray(value)) {
      let raw = 0;
      for (const [bit, label] of Object.entries(field.bits || {})) {
        if (value.includes(label)) raw |= (1 << Number(bit));
      }
      return raw;
    }
    return Number(value) || 0;
  }
  const scale = field.scale ?? 1;
  const off = field.offset ?? 0;
  return Math.round((Number(value) - off) / scale);
}

function encodeFrame(config, cmdKey, values) {
  const cmd = (config.commands || {})[cmdKey];
  if (!cmd) throw new Error("未定义的命令 " + cmdKey);
  const cs = config.frame.checksum || { type: "none", size: 0 };
  const cf = config.commandField;
  let pos = cf.offset + cf.size;
  const fieldBytes = [];
  for (const field of cmd.fields) {
    const size = field.type === "bytes" ? field.size : ENC_TYPE_SIZE[field.type];
    const chunk = new Array(size).fill(0);
    const value = values ? values[field.name] : undefined;
    if (field.type === "bytes") {
      const arr = Array.isArray(value) ? value : [];
      arr.slice(0, size).forEach((b, i) => { chunk[i] = b & 0xFF; });
    } else if (field.type === "float32") {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setFloat32(0, Number(value) || 0, field.endian !== "big");
      chunk.set(new Uint8Array(dv.buffer));
    } else {
      let raw = fieldRawValue(field, value ?? 0);
      if (raw < 0) raw += 2 ** (size * 8);
      writeUint(chunk, 0, raw, size, field.endian === "big");
    }
    fieldBytes.push(...chunk);
    pos += size;
  }
  const total = pos + cs.size;
  const buf = new Array(total).fill(0);
  (config.frame.header || []).forEach((b, i) => { buf[i] = b; });
  const cmdVal = parseInt(cmdKey, 16);
  writeUint(buf, cf.offset, cmdVal, cf.size, true);
  fieldBytes.forEach((b, i) => { buf[cf.offset + cf.size + i] = b; });
  if (config.frame.lengthField) {
    const lf = config.frame.lengthField;
    const lenVal = total - cs.size - cf.offset;
    writeUint(buf, lf.offset, lenVal, lf.size, true);
  }
  if (cs.type && cs.type !== "none") {
    const body = buf.slice(0, total - cs.size);
    const c = encChecksum(cs.type, body);
    writeUint(buf, total - cs.size, c, cs.size, cs.endian === "big");
  }
  return buf;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { encodeFrame };
}
