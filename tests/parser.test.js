"use strict";
const assert = require("assert");
const { parseFrame, crc16Modbus } = require("../src/parser");
const config = require("../examples/robot-status.json");

function hex(s) { return s.trim().split(/\s+/).map(x => parseInt(x, 16)); }
function withCrc(body) {
  const crc = crc16Modbus(body);
  return [...body, crc & 0xFF, (crc >> 8) & 0xFF];
}

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("✓", name); }

// 1. 演示帧：转速 1500, 温度 36.5, 电量 87, 运行中, CRC 正确
check("演示帧解析正确", () => {
  const r = parseFrame(config, hex("AA 55 07 21 DC 05 6D 01 57 01 88 D2"));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.checksumOk, true);
  assert.strictEqual(r.commandName, "状态上报");
  const byName = Object.fromEntries(r.fields.map(f => [f.name, f]));
  assert.strictEqual(byName["电机转速"].value, 1500);
  assert.strictEqual(byName["温度"].value, 36.5);
  assert.strictEqual(byName["电量"].value, 87);
  assert.deepStrictEqual(byName["状态位"].value, ["运行"]);
});

// 2. 坏帧：改一个数据字节，CRC 必须拦截
check("数据被改后校验拦截", () => {
  const r = parseFrame(config, hex("AA 55 07 21 DD 05 6D 01 57 01 88 D2"));
  assert.strictEqual(r.checksumOk, false);
  assert.strictEqual(r.ok, false);
});

// 3. 帧头错误拦截
check("帧头错误拦截", () => {
  const r = parseFrame(config, hex("AB 55 07 21 DC 05 6D 01 57 01 88 D2"));
  assert.strictEqual(r.ok, false);
});

// 4. 命令分支：0x22 灯光状态，枚举解析
check("命令分支 + 枚举解析", () => {
  const body = [0xAA, 0x55, 0x03, 0x22, 0x01, 0x50];
  const r = parseFrame(config, withCrc(body));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.commandName, "灯光状态");
  const byName = Object.fromEntries(r.fields.map(f => [f.name, f]));
  assert.strictEqual(byName["灯开关"].value, "开");
  assert.strictEqual(byName["亮度"].value, 80);
});

// 5. 未定义命令报错而不是崩溃
check("未定义命令报错", () => {
  const body = [0xAA, 0x55, 0x02, 0x7F, 0x00];
  const r = parseFrame(config, withCrc(body));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.includes("未定义的命令")));
});

// 6. 位标志多位
check("状态位多位解析", () => {
  const body = [0xAA, 0x55, 0x07, 0x21, 0x00, 0x00, 0x00, 0x00, 0x64, 0x05];
  const r = parseFrame(config, withCrc(body));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  const f = r.fields.find(x => x.name === "状态位");
  assert.deepStrictEqual(f.value, ["运行", "充电"]);
});

console.log(`\n全部 ${passed} 个测试通过`);
