"use strict";
// 代码生成器：同一份协议配置 -> JS / Python / C 解析代码 + Markdown 协议文档
// 这是团队版的核心：一处修改定义，三端代码和文档一起重新生成，永远一致。

const CG_TYPE_SIZE = { uint8: 1, int8: 1, uint16: 2, int16: 2, uint32: 4, int32: 4, float32: 4, enum: 1, bits: 1 };

function fieldSize(f) { return f.type === "bytes" ? f.size : CG_TYPE_SIZE[f.type]; }

function layout(config, cmd) {
  let byteOffset = config.commandField.offset + config.commandField.size;
  return cmd.fields.map(f => {
    const item = { ...f, byteOffset, size: fieldSize(f) };
    byteOffset += item.size;
    return item;
  });
}

function generateMarkdown(config) {
  const lines = [];
  lines.push(`# ${config.name || "协议文档"}`);
  lines.push("");
  lines.push("> 本文档由协议配置自动生成，请勿手工修改。协议有变更时改配置后重新生成。");
  lines.push("");
  const fr = config.frame;
  lines.push("## 帧结构");
  lines.push("");
  lines.push(`- 帧头：${(fr.header || []).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ")}`);
  if (fr.lengthField) lines.push(`- 长度字段：第 ${fr.lengthField.offset} 字节起 ${fr.lengthField.size} 字节，值为命令字段起到校验前的字节数`);
  if (fr.checksum) lines.push(`- 校验：${fr.checksum.type}，${fr.checksum.size} 字节，${fr.checksum.endian === "big" ? "大端" : "小端（低字节在前）"}`);
  lines.push(`- 命令字段：第 ${config.commandField.offset} 字节起 ${config.commandField.size} 字节`);
  lines.push("");
  for (const [key, cmd] of Object.entries(config.commands)) {
    lines.push(`## 命令 ${key}：${cmd.name}`);
    lines.push("");
    lines.push("| 字段 | 偏移 | 长度(字节) | 类型 | 大小端 | 倍率 | 单位 | 说明 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const f of layout(config, cmd)) {
      let note = "";
      if (f.type === "enum") note = Object.entries(f.choices || {}).map(([v, l]) => `${v}=${l}`).join("，");
      if (f.type === "bits") note = Object.entries(f.bits || {}).map(([v, l]) => `bit${v}=${l}`).join("，");
      lines.push(`| ${f.name} | ${f.byteOffset} | ${f.size} | ${f.type} | ${f.endian || "-"} | ${f.scale ?? 1} | ${f.unit || "-"} | ${note} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// JS / Python 生成：内嵌配置 + 通用运行时（生成物可直接独立运行）
const JS_RUNTIME = `
function crc16Modbus(bytes){let crc=0xFFFF;for(const b of bytes){crc^=b;for(let i=0;i<8;i++){crc=(crc&1)?((crc>>1)^0xA001):(crc>>1);}}return crc;}
const TSZ={uint8:1,int8:1,uint16:2,int16:2,uint32:4,int32:4,float32:4,enum:1,bits:1};
function parseFrame(bytes){
  const cfg=CONFIG,out={ok:false,errors:[],fields:[]};
  const fr=cfg.frame,cs=fr.checksum||{type:"none",size:0};
  for(let i=0;i<(fr.header||[]).length;i++){if(bytes[i]!==fr.header[i]){out.errors.push("header mismatch");return out;}}
  if(cs.type==="crc16_modbus"){
    const calc=crc16Modbus(bytes.slice(0,bytes.length-cs.size));
    let recv=0;const tail=bytes.slice(bytes.length-cs.size);const ord=cs.endian==="big"?tail:[...tail].reverse();
    for(const b of ord)recv=recv*256+b;
    out.checksumOk=calc===recv;if(!out.checksumOk)out.errors.push("checksum fail");
  } else out.checksumOk=true;
  let cmdVal=0;for(let i=0;i<cfg.commandField.size;i++)cmdVal=cmdVal*256+bytes[cfg.commandField.offset+i];
  const key="0x"+cmdVal.toString(16).toUpperCase().padStart(2,"0");
  const cmd=(cfg.commands||{})[key];out.command=key;
  if(!cmd){out.errors.push("unknown command "+key);return out;}
  out.commandName=cmd.name;
  let off=cfg.commandField.offset+cfg.commandField.size;
  for(const f of cmd.fields){
    const size=f.type==="bytes"?f.size:TSZ[f.type];const sl=bytes.slice(off,off+size);
    let v=0;const ord=f.endian==="big"?sl:[...sl].reverse();for(const b of ord)v=v*256+b;
    const bits=size*8;if(f.type.startsWith("int")&&v>=2**(bits-1))v-=2**bits;
    const item={name:f.name,raw:v};
    if(f.type==="bits")item.value=Object.entries(f.bits||{}).filter(([bit])=>v&(1<<Number(bit))).map(([,l])=>l);
    else if(f.type==="enum")item.value=(f.choices||{})[String(v)]??v;
    else item.value=v*(f.scale??1)+(f.offset??0);
    if(f.unit)item.unit=f.unit;
    out.fields.push(item);off+=size;
  }
  out.ok=out.errors.length===0;return out;
}
if(typeof module!=="undefined"&&module.exports){module.exports={parseFrame};}`;

function generateJS(config) {
  return `"use strict";\n// 由协议配置自动生成：${config.name || ""}\nconst CONFIG = ${JSON.stringify(config, null, 2)};\n${JS_RUNTIME}\n`;
}

const PY_RUNTIME = `
def _crc16_modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc

_TSZ = {"uint8":1,"int8":1,"uint16":2,"int16":2,"uint32":4,"int32":4,"float32":4,"enum":1,"bits":1}

def parse_frame(data):
    cfg = CONFIG
    out = {"ok": False, "errors": [], "fields": []}
    fr = cfg["frame"]; cs = fr.get("checksum") or {"type": "none", "size": 0}
    for i, h in enumerate(fr.get("header") or []):
        if data[i] != h:
            out["errors"].append("header mismatch"); return out
    if cs["type"] == "crc16_modbus":
        calc = _crc16_modbus(data[:len(data)-cs["size"]])
        tail = data[len(data)-cs["size"]:]
        recv = int.from_bytes(tail, "big" if cs.get("endian") == "big" else "little")
        out["checksum_ok"] = calc == recv
        if not out["checksum_ok"]: out["errors"].append("checksum fail")
    else:
        out["checksum_ok"] = True
    cf = cfg["commandField"]
    cmd_val = int.from_bytes(data[cf["offset"]:cf["offset"]+cf["size"]], "big")
    key = "0x%02X" % cmd_val
    cmd = (cfg.get("commands") or {}).get(key)
    out["command"] = key
    if cmd is None:
        out["errors"].append("unknown command " + key); return out
    out["command_name"] = cmd["name"]
    off = cf["offset"] + cf["size"]
    for f in cmd["fields"]:
        size = f["size"] if f["type"] == "bytes" else _TSZ[f["type"]]
        raw = int.from_bytes(data[off:off+size], "big" if f.get("endian") == "big" else "little", signed=f["type"].startswith("int"))
        item = {"name": f["name"], "raw": raw}
        if f["type"] == "bits":
            item["value"] = [label for bit, label in (f.get("bits") or {}).items() if raw & (1 << int(bit))]
        elif f["type"] == "enum":
            item["value"] = (f.get("choices") or {}).get(str(raw), raw)
        else:
            item["value"] = raw * f.get("scale", 1) + f.get("offset", 0)
        if f.get("unit"): item["unit"] = f["unit"]
        out["fields"].append(item); off += size
    out["ok"] = len(out["errors"]) == 0
    return out
`;

function generatePython(config) {
  return `# 由协议配置自动生成：${config.name || ""}\nimport json\nCONFIG = json.loads(r'''${JSON.stringify(config, null, 2)}''')\n${PY_RUNTIME}\n`;
}

function generateC(config) {
  const cs = config.frame.checksum || { type: "none", size: 0 };
  const lines = [];
  lines.push(`/* 由协议配置自动生成：${config.name || ""}`);
  lines.push(" * values[] 按当前命令的字段顺序存放物理值（bits/enum 存原始值），names[] 为对应字段名。 */");
  lines.push("#include <stdint.h>");
  lines.push("#include <stddef.h>");
  lines.push("");
  if (cs.type === "crc16_modbus") {
    lines.push("static uint16_t crc16_modbus(const uint8_t *data, size_t len) {");
    lines.push("  uint16_t crc = 0xFFFF;");
    lines.push("  for (size_t i = 0; i < len; i++) { crc ^= data[i]; for (int j = 0; j < 8; j++) crc = (crc & 1) ? (uint16_t)((crc >> 1) ^ 0xA001) : (uint16_t)(crc >> 1); }");
    lines.push("  return crc;");
    lines.push("}");
    lines.push("");
  }
  lines.push("typedef struct { uint8_t cmd; int checksum_ok; int value_count; double values[32]; } ParseResult;");
  lines.push("");
  lines.push("static double read_field(const uint8_t *d, int off, int size, int big_endian, int is_signed) {");
  lines.push("  uint32_t v = 0;");
  lines.push("  if (big_endian) { for (int i = 0; i < size; i++) v = v * 256 + d[off + i]; }");
  lines.push("  else { for (int i = size - 1; i >= 0; i--) v = v * 256 + d[off + i]; }");
  lines.push("  if (is_signed) { int bits = size * 8; if (v >= (1u << (bits - 1))) return (double)((int64_t)v - (int64_t)(1ull << bits)); }");
  lines.push("  return (double)v;");
  lines.push("}");
  lines.push("");
  lines.push("ParseResult parse_frame(const uint8_t *data, size_t len) {");
  lines.push("  ParseResult r = {0}; r.checksum_ok = 1;");
  const header = config.frame.header || [];
  header.forEach((b, i) => lines.push(`  if (len < ${i + 1} || data[${i}] != 0x${b.toString(16).toUpperCase()}) { r.checksum_ok = 0; return r; }`));
  if (cs.type === "crc16_modbus") {
    const read = cs.endian === "big"
      ? `(uint16_t)((data[len - 2] << 8) | data[len - 1])`
      : `(uint16_t)(data[len - 2] | (data[len - 1] << 8))`;
    lines.push(`  if (len < ${cs.size} || crc16_modbus(data, len - ${cs.size}) != ${read}) r.checksum_ok = 0;`);
  }
  const cf = config.commandField;
  lines.push(`  uint8_t cmd = data[${cf.offset}];`);
  lines.push("  r.cmd = cmd;");
  lines.push("  switch (cmd) {");
  for (const [key, cmd] of Object.entries(config.commands)) {
    lines.push(`    case ${key}: { /* ${cmd.name} */`);
    layout(config, cmd).forEach((f, idx) => {
      const scale = f.scale ?? 1, offv = f.offset ?? 0;
      lines.push(`      r.values[${idx}] = read_field(data, ${f.byteOffset}, ${f.size}, ${f.endian === "big" ? 1 : 0}, ${f.type.startsWith("int") ? 1 : 0}) * ${scale} + ${offv}; /* ${f.name}${f.unit ? " " + f.unit : ""} */`);
    });
    lines.push(`      r.value_count = ${cmd.fields.length};`);
    lines.push("      break; }");
  }
  lines.push("    default: r.value_count = -1; break;");
  lines.push("  }");
  lines.push("  return r;");
  lines.push("}");
  return lines.join("\n") + "\n";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { generateJS, generatePython, generateC, generateMarkdown, layout };
}
