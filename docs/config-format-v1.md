# 协议配置格式 v1（草案，已冻结用于 MVP）

核心思想：不统一各家协议内容，只统一“描述协议的方法”。
一份配置 = 一个设备的协议。换设备只换配置，解析引擎不变。

借鉴来源：
- 字段属性模型借鉴 cantools 的 signal 定义：起始位置、长度、大小端、有无符号、倍率 scale、偏移 offset、单位 unit、枚举 choices、位定义 bits。
- 按命令字分支借鉴 Kaitai Struct 的 switch-on：先读命令字段，再按值选择字段组。
- 配置文件组织借鉴 Serial Studio 的 .ssproj：连接、帧定义、字段分组分开。

## 帧结构（frame）
- header: 帧头字节数组，如 [170, 85] 即 AA 55
- lengthField: { offset, size } 长度字段所在位置；其值 = 从命令字段起、到校验前为止的字节数
- checksum: { type: crc16_modbus | sum8 | xor8 | none, size, endian: little|big }
  校验范围：整帧去掉校验字节本身。

## 命令分支（commands）
- commandField: { offset, size } 命令字段位置
- commands: 以命令值（十六进制字符串，如 "0x21"）为键，每条命令有 name 和 fields 数组
- fields 按顺序排列，偏移自动顺延（从命令字段之后开始），不用手写每个偏移

## 字段（field）
- name 字段名
- type: uint8 | int8 | uint16 | int16 | uint32 | int32 | float32 | enum | bits | bytes
- size: 仅 bytes 类型需要（字节数）；数值类型由 type 决定
- endian: little | big（多字节时）
- scale / offset: 物理值 = 原始值 × scale + offset
- unit: 单位字符串
- choices: enum 类型的取值对照 { "0": "关", "1": "开" }
- bits: bits 类型的位对照 { "0": "运行", "1": "故障" }，size 固定 1 字节（v1）

## v1 明确不支持（避免范围膨胀）
- 可变长字段按表达式计算长度（v2 再加，先用命令分支 + 固定结构覆盖绝大多数联调场景）
- ASCII 文本协议（v1 只做二进制帧）
- 多级嵌套结构

## 开发排期（2026-11-26 起，目标 v0.1 自用版 2026-12-10 前后）
1. 11-26 ~ 11-27 配置格式 v1 + 解析引擎 + 自动化测试
2. 11-28 ~ 12-02 网页界面：粘贴十六进制 / 模拟设备发送，实时解析，原始帧与字段对照
3. 12-03 ~ 12-05 接 Web Serial（电脑 Chrome）真实串口收发
4. 12-06 ~ 12-08 Web Bluetooth（BLE）连接 + 录制/回放
5. 12-09 ~ 12-10 配置编辑界面 + 打磨，交付 v0.1，用户拿真实设备联调验收
注：时间为目标排期，真机联调阶段需要用户配合测试并反馈录制数据。
