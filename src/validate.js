"use strict";
// 配置校验：团队里多人改配置时，先校验再使用，把错误拦在联调之前。
// 返回错误字符串数组，空数组表示通过。

const KNOWN_TYPES = ["uint8", "int8", "uint16", "int16", "uint32", "int32", "float32", "enum", "bits", "bytes"];
const KNOWN_CHECKSUMS = ["crc16_modbus", "sum8", "xor8", "none"];

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") return ["配置不是一个对象"];
  const fr = config.frame;
  if (!fr) errors.push("缺少 frame 帧结构定义");
  else {
    if (!Array.isArray(fr.header) || fr.header.length === 0) errors.push("frame.header 帧头为空");
    else if (fr.header.some(b => typeof b !== "number" || b < 0 || b > 255)) errors.push("frame.header 里有超出 0-255 的值");
    if (fr.checksum && !KNOWN_CHECKSUMS.includes(fr.checksum.type)) errors.push(`不支持的校验类型：${fr.checksum.type}（v1 支持 ${KNOWN_CHECKSUMS.join("/")}）`);
    if (fr.lengthField && fr.header && fr.lengthField.offset < fr.header.length) errors.push("长度字段位置和帧头重叠了");
  }
  const cf = config.commandField;
  if (!cf) errors.push("缺少 commandField 命令字段定义");
  if (!config.commands || Object.keys(config.commands).length === 0) errors.push("commands 里一条命令都没有");
  for (const [key, cmd] of Object.entries(config.commands || {})) {
    if (!/^0x[0-9a-fA-F]+$/.test(key)) errors.push(`命令键格式不对：${key}（应为 0x21 这种形式）`);
    if (!cmd.fields || cmd.fields.length === 0) { errors.push(`命令 ${key} 没有字段`); continue; }
    const seen = new Set();
    for (const f of cmd.fields) {
      if (!f.name) errors.push(`命令 ${key} 里有字段没写名字`);
      else if (seen.has(f.name)) errors.push(`命令 ${key} 里字段名重复：${f.name}`);
      seen.add(f.name);
      if (!KNOWN_TYPES.includes(f.type)) errors.push(`字段 ${f.name} 类型不支持：${f.type}`);
      if (f.type === "bytes" && (!f.size || f.size <= 0)) errors.push(`字段 ${f.name} 是 bytes 类型，必须给正数的 size`);
      if (f.scale !== undefined && f.scale === 0) errors.push(`字段 ${f.name} 的 scale 不能是 0`);
      if (f.type === "enum" && (!f.choices || Object.keys(f.choices).length === 0)) errors.push(`字段 ${f.name} 是 enum 类型，必须给 choices 枚举对照`);
      if (f.type === "bits") {
        if (!f.bits || Object.keys(f.bits).length === 0) errors.push(`字段 ${f.name} 是 bits 类型，必须给 bits 位对照`);
        else for (const bit of Object.keys(f.bits)) if (Number(bit) < 0 || Number(bit) > 7) errors.push(`字段 ${f.name} 的位定义超出 0-7：bit${bit}`);
      }
    }
  }
  return errors;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateConfig };
}
