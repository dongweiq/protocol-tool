"use strict";
// 验证“一处配置、三端生成”：JS / Python / C 生成代码解析同一帧，结果必须一致。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { generateJS, generatePython, generateC, generateMarkdown } = require("../src/codegen");
const config = require("../examples/robot-status.json");

const FRAME = [0xAA, 0x55, 0x07, 0x21, 0xDC, 0x05, 0x6D, 0x01, 0x57, 0x01, 0x88, 0xD2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-"));
let passed = 0;
function check(name, fn) { fn(); passed++; console.log("✓", name); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: ${a} !== ${b}`); }

// JS 生成代码
let jsResult;
check("JS 生成代码解析演示帧", () => {
  const file = path.join(tmp, "parser.gen.js");
  fs.writeFileSync(file, generateJS(config));
  const gen = require(file);
  jsResult = gen.parseFrame(FRAME);
  assertEq(jsResult.ok, true, "js ok");
  const byName = Object.fromEntries(jsResult.fields.map(f => [f.name, f.value]));
  assertEq(byName["电机转速"], 1500, "js 转速");
  assertEq(byName["温度"], 36.5, "js 温度");
  assertEq(byName["电量"], 87, "js 电量");
});

// Python 生成代码
check("Python 生成代码解析同一帧，结果与 JS 一致", () => {
  const file = path.join(tmp, "parser_gen.py");
  fs.writeFileSync(file, generatePython(config));
  const runner = path.join(tmp, "run.py");
  fs.writeFileSync(runner, `import json, sys\nsys.path.insert(0, ${JSON.stringify(tmp)})\nfrom parser_gen import parse_frame\nr = parse_frame(bytes(${JSON.stringify(FRAME)}))\nprint(json.dumps(r, ensure_ascii=False))\n`);
  const out = execFileSync("python3", [runner], { encoding: "utf-8" });
  const r = JSON.parse(out);
  assertEq(r.ok, true, "py ok");
  const byName = Object.fromEntries(r.fields.map(f => [f.name, f.value]));
  assertEq(byName["电机转速"], 1500, "py 转速");
  assertEq(byName["温度"], 36.5, "py 温度");
  assertEq(byName["电量"], 87, "py 电量");
});

// C 生成代码（gcc 编译运行）
check("C 生成代码解析同一帧，结果一致", () => {
  const cFile = path.join(tmp, "parser_gen.c");
  const mainFile = path.join(tmp, "main.c");
  const exe = path.join(tmp, "gen_test");
  fs.writeFileSync(cFile, generateC(config));
  fs.writeFileSync(mainFile, `#include <stdio.h>\n#include <stdint.h>\n#include <stddef.h>\ntypedef struct { uint8_t cmd; int checksum_ok; int value_count; double values[32]; } ParseResult;\nParseResult parse_frame(const uint8_t *data, size_t len);\nint main(void){ uint8_t f[] = {${FRAME.join(",")}}; ParseResult r = parse_frame(f, sizeof(f)); printf("ok=%d cmd=0x%02X n=%d v0=%.1f v1=%.1f v2=%.1f\\n", r.checksum_ok, r.cmd, r.value_count, r.values[0], r.values[1], r.values[2]); return 0; }\n`);
  execFileSync("gcc", ["-std=c99", "-Wall", "-o", exe, cFile, mainFile]);
  const out = execFileSync(exe, [], { encoding: "utf-8" }).trim();
  console.log("  C 输出:", out);
  if (!out.startsWith("ok=1 cmd=0x21 n=4 v0=1500.0 v1=36.5 v2=87.0")) throw new Error("C 解析结果不符: " + out);
});

// Markdown 文档
check("Markdown 协议文档生成", () => {
  const md = generateMarkdown(config);
  for (const s of ["状态上报", "电机转速", "温度", "crc16_modbus", "bit0=运行"]) {
    if (!md.includes(s)) throw new Error("文档缺: " + s);
  }
});

console.log(`\n全部 ${passed} 个生成验证通过`);
