"use strict";
// v0.3 新功能测试：拼帧编码器 / 流式拆帧器 / 配置校验 / CSV 导入
const { parseFrame } = require("../src/parser.js");
const { encodeFrame } = require("../src/encoder.js");
const { createSplitter } = require("../src/framing.js");
const { validateConfig } = require("../src/validate.js");
const { importCSV } = require("../src/importer.js");
const config = require("../examples/robot-status.json");

const DEMO = [0xAA, 0x55, 0x07, 0x21, 0xDC, 0x05, 0x6D, 0x01, 0x57, 0x01, 0x88, 0xD2];
let passed = 0, failed = 0;
function check(name, cond) { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. 编码器：用演示值拼帧，应与手工验证过的演示帧逐字节一致
const enc = encodeFrame(config, "0x21", { "电机转速": 1500, "温度": 36.5, "电量": 87, "状态位": ["运行"] });
check("编码器拼出的帧与演示帧逐字节一致", eq(enc, DEMO));

// 2. 往返：拼帧 -> 解析，值一致（含枚举命令 0x22）
const f22 = encodeFrame(config, "0x22", { "灯开关": "开", "亮度": 80 });
const p22 = parseFrame(config, f22);
check("0x22 往返：枚举标签与亮度一致", p22.ok && p22.fields[0].value === "开" && p22.fields[1].value === 80);

// 3. 编码器：负数与位组合
const fNeg = encodeFrame(config, "0x21", { "电机转速": -500, "温度": -10.5, "电量": 3, "状态位": ["故障", "充电"] });
const pNeg = parseFrame(config, fNeg);
check("负数与多状态位往返一致", pNeg.ok && pNeg.fields[0].value === -500 && pNeg.fields[1].value === -10.5 && eq(pNeg.fields[3].value, ["故障", "充电"]));

// 4. 拆帧器：一个字节一个字节喂（半包）
const got1 = [];
const sp1 = createSplitter(config, f => got1.push(f));
for (const b of DEMO) sp1.feed([b]);
check("拆帧器逐字节喂入能拼出一帧", got1.length === 1 && eq(got1[0], DEMO));

// 5. 拆帧器：两帧粘在一起 + 前面有杂字节
const got2 = [];
const sp2 = createSplitter(config, f => got2.push(f));
sp2.feed([0x00, 0xFF, ...DEMO, ...DEMO]);
check("拆帧器处理粘包与杂字节", got2.length === 2 && eq(got2[1], DEMO));

// 6. 校验器：示例配置通过；坏配置报错
check("示例配置校验通过", validateConfig(config).length === 0);
const bad = JSON.parse(JSON.stringify(config));
bad.commands["0x21"].fields.push({ name: "电机转速", type: "uint64" });
bad.commands["0x21"].fields.push({ name: "x", type: "bits", bits: { 9: "越界" } });
const errs = validateConfig(bad);
check("坏配置被拦下（重复名/未知类型/位越界）", errs.length >= 3);

// 7. CSV 导入：字段表 -> 配置 -> 解析演示帧结果一致
const csv = [
  "命令,命令名称,字段,类型,大小端,倍率,偏移,单位,枚举,位定义",
  "0x21,状态上报,电机转速,int16,little,,,,",
  "0x21,状态上报,电机温度,int16,little,0.1,,℃,,",
  "0x21,状态上报,电池电量,uint8,,,,%,,",
  "0x21,状态上报,状态标志,bits,,,,,,0=运行;1=故障;2=充电",
  "0x22,灯光状态,灯光模式,enum,,,,,0=关;1=开;2=自动,",
  "0x22,灯光状态,亮度,uint8,,,,,,",
].join("\n");
const imported = importCSV(csv, { name: "机器人协议（CSV导入）" });
const pi = parseFrame(imported, DEMO);
check("CSV 导入的配置能解析演示帧", pi.ok && pi.fields[0].value === 1500 && pi.fields[1].value === 36.5 && pi.fields[2].value === 87);
check("CSV 导入的配置通过校验", validateConfig(imported).length === 0);
const fImp = encodeFrame(imported, "0x21", { "电机转速": 1500, "电机温度": 36.5, "电池电量": 87, "状态标志": ["运行"] });
check("CSV 导入配置拼帧与演示帧一致", eq(fImp, DEMO));

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
