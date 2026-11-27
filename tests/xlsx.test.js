"use strict";
// v0.4 新功能测试：Excel（.xlsx）直接导入
// 测试里用 zlib 现场构造一个最小的真实 .xlsx（zip + sharedStrings + sheet XML），
// 与 v0.3 的 CSV 测试用同一张字段表，验证两者导入结果一致。
const zlib = require("zlib");
const { parseFrame } = require("../src/parser.js");
const { encodeFrame } = require("../src/encoder.js");
const { validateConfig } = require("../src/validate.js");
const { importCSV } = require("../src/importer.js");
const { parseXlsx, importXlsx, xlsxParseSharedStrings } = require("../src/xlsx.js");

const DEMO = [0xAA, 0x55, 0x07, 0x21, 0xDC, 0x05, 0x6D, 0x01, 0x57, 0x01, 0x88, 0xD2];
let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 最小 zip 构造器（带 CRC32） ----
const CRC_TABLE = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {
  // files: [{ name, data: Buffer, method: 0 | 8 }]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const raw = f.method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name, "utf-8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(f.method, 8);
    lh.writeUInt32LE(crc32(f.data), 14);
    lh.writeUInt32LE(raw.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    chunks.push(lh, name, raw);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(f.method, 10);
    cd.writeUInt32LE(crc32(f.data), 16);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + raw.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

// ---- 与 v0.3 CSV 测试同一张表 ----
const STRINGS = ["命令", "命令名称", "字段", "类型", "大小端", "倍率", "偏移", "单位", "枚举", "位定义",
  "0x21", "状态上报", "电机转速", "int16", "little", "电机温度", "0.1", "℃", "电池电量", "uint8", "%",
  "状态标志", "bits", "0=运行;1=故障;2=充电", "0x22", "灯光状态", "灯光模式", "enum", "0=关;1=开;2=自动", "亮度"];
const S = s => STRINGS.indexOf(s);
function cell(ref, value, type) {
  if (type === "s") return `<c r="${ref}" t="s"><v>${value}</v></c>`;
  if (type === "inlineStr") return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  return `<c r="${ref}"><v>${value}</v></c>`; // 数字
}
function buildSheetXml() {
  const rows = [
    ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map((c, i) => cell(c + "1", S(STRINGS[i]), "s")).join(""),
    [cell("A2", S("0x21"), "s"), cell("B2", S("状态上报"), "s"), cell("C2", S("电机转速"), "s"), cell("D2", S("int16"), "s"), cell("E2", S("little"), "s")].join(""),
    // 温度行：字段名用 inlineStr、倍率用数字单元格，覆盖两种单元格写法
    [cell("A3", S("0x21"), "s"), cell("B3", S("状态上报"), "s"), cell("C3", "电机温度", "inlineStr"), cell("D3", S("int16"), "s"), cell("E3", S("little"), "s"), cell("F3", 0.1), cell("H3", S("℃"), "s")].join(""),
    [cell("A4", S("0x21"), "s"), cell("B4", S("状态上报"), "s"), cell("C4", S("电池电量"), "s"), cell("D4", S("uint8"), "s"), cell("H4", S("%"), "s")].join(""),
    [cell("A5", S("0x21"), "s"), cell("B5", S("状态上报"), "s"), cell("C5", S("状态标志"), "s"), cell("D5", S("bits"), "s"), cell("J5", S("0=运行;1=故障;2=充电"), "s")].join(""),
    [cell("A6", S("0x22"), "s"), cell("B6", S("灯光状态"), "s"), cell("C6", S("灯光模式"), "s"), cell("D6", S("enum"), "s"), cell("I6", S("0=关;1=开;2=自动"), "s")].join(""),
    [cell("A7", S("0x22"), "s"), cell("B7", S("灯光状态"), "s"), cell("C7", S("亮度"), "s"), cell("D7", S("uint8"), "s")].join(""),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
    + rows.map((r, i) => `<row r="${i + 1}">${r}</row>`).join("") + `</sheetData></worksheet>`;
}
function buildXlsx(method) {
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${STRINGS.length}" uniqueCount="${STRINGS.length}">`
    + STRINGS.map(s => `<si><t>${s}</t></si>`).join("") + `</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="协议表" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`), method },
    { name: "xl/workbook.xml", data: Buffer.from(workbook), method },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(rels), method },
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared, "utf-8"), method },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(buildSheetXml(), "utf-8"), method },
  ]);
}

(async () => {
  const xlsxDeflated = buildXlsx(8);
  const xlsxStored = buildXlsx(0);

  // 1. 读出与 CSV 同样的行数据
  const rows = await parseXlsx(xlsxDeflated);
  check("xlsx 读出 7 行（表头 + 6 行字段）", rows.length === 7);
  check("表头与 CSV 一致", eq(rows[0], ["命令", "命令名称", "字段", "类型", "大小端", "倍率", "偏移", "单位", "枚举", "位定义"]));
  check("inlineStr 单元格与数字单元格都读对了", rows[2][2] === "电机温度" && rows[2][5] === "0.1" && rows[2][7] === "℃");
  check("空单元格补空串，位定义在第 10 列", rows[4][9] === "0=运行;1=故障;2=充电" && rows[4][5] === "");

  // 2. 导入的配置能解析演示帧、通过校验、拼帧往返一致
  const cfg = await importXlsx(xlsxDeflated, { name: "机器人协议（xlsx导入）" });
  const p = parseFrame(cfg, DEMO);
  check("xlsx 导入的配置能解析演示帧", p.ok && p.fields[0].value === 1500 && p.fields[1].value === 36.5 && p.fields[2].value === 87);
  check("xlsx 导入的配置通过校验", validateConfig(cfg).length === 0);
  const f = encodeFrame(cfg, "0x21", { "电机转速": 1500, "电机温度": 36.5, "电池电量": 87, "状态标志": ["运行"] });
  check("xlsx 导入配置拼帧与演示帧一致", eq(f, DEMO));

  // 3. 与 CSV 导入同一张表结果一致（命令与帧结构相同）
  const csv = [
    "命令,命令名称,字段,类型,大小端,倍率,偏移,单位,枚举,位定义",
    "0x21,状态上报,电机转速,int16,little,,,,",
    "0x21,状态上报,电机温度,int16,little,0.1,,℃,,",
    "0x21,状态上报,电池电量,uint8,,,,%,,",
    "0x21,状态上报,状态标志,bits,,,,,,0=运行;1=故障;2=充电",
    "0x22,灯光状态,灯光模式,enum,,,,,0=关;1=开;2=自动,",
    "0x22,灯光状态,亮度,uint8,,,,,,",
  ].join("\n");
  const csvCfg = importCSV(csv, {});
  check("xlsx 与 CSV 导入同一张表，命令与帧结构一致", eq(cfg.commands, csvCfg.commands) && eq(cfg.frame, csvCfg.frame));

  // 4. 未压缩（stored）条目也能读
  const rowsStored = await parseXlsx(xlsxStored);
  check("stored 方式存储的 xlsx 也能读", eq(rowsStored, rows));

  // 5. 共享字符串里的 XML 转义
  check("共享字符串 XML 转义还原", eq(xlsxParseSharedStrings(`<sst><si><t>温度&amp;湿度&lt;上限&gt;</t></si><si><t>正常</t></si></sst>`), ["温度&湿度<上限>", "正常"]));

  // 6. 不是 xlsx 时报错，不静默出空配置
  let threw = false;
  try { await parseXlsx(Buffer.from("hello, not a zip")); } catch (e) { threw = /不是 xlsx/.test(e.message); }
  check("非 xlsx 文件明确报错", threw);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log("  ✗ 测试崩溃：" + e.message); process.exit(1); });
