"use strict";
// 流式拆帧器：串口/蓝牙收到的是字节流，可能粘包（一包多帧）、半包（一帧分几包到）、带杂字节。
// 按配置的帧头找帧、按长度字段切帧，逐帧回调。已在网页工具中使用同款逻辑，这里抽成可测试的模块。

function indexOfSub(arr, sub) {
  outer: for (let i = 0; i + sub.length <= arr.length; i++) {
    for (let j = 0; j < sub.length; j++) if (arr[i + j] !== sub[j]) continue outer;
    return i;
  }
  return -1;
}

function createSplitter(config, onFrame) {
  let buf = [];
  function feed(chunk) {
    buf.push(...chunk);
    const header = (config.frame && config.frame.header) || [];
    const csSize = (config.frame.checksum && config.frame.checksum.size) || 0;
    const lf = config.frame.lengthField;
    if (!lf) throw new Error("配置缺少 lengthField，无法流式拆帧");
    while (buf.length >= 4) {
      const idx = header.length ? indexOfSub(buf, header) : 0;
      if (idx === -1) { buf = header.length > 1 ? buf.slice(-(header.length - 1)) : []; return; }
      if (idx > 0) buf = buf.slice(idx);
      if (buf.length <= lf.offset) return;
      const lenVal = buf[lf.offset];
      const total = config.commandField.offset + lenVal + csSize;
      if (total <= 0 || total > 4096) { buf = buf.slice(1); continue; }
      if (buf.length < total) return;
      onFrame(buf.slice(0, total));
      buf = buf.slice(total);
    }
  }
  return { feed, pending: () => [...buf] };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSplitter };
}
