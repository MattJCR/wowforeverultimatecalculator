// Lector mínimo de literales de tabla Lua (el formato de SavedVariables): cadenas, números, booleanos, nil y tablas anidadas.
export function parseLuaTable(src) {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("--", i)) { while (i < src.length && src[i] !== "\n") i++; } else return;
    }
  };
  const str = () => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        i++;
        const c = src[i++];
        out += { n: "\n", t: "\t", r: "\r" }[c] ?? c;
      } else out += src[i++];
    }
    i++;
    return out;
  };
  const value = () => {
    ws();
    const c = src[i];
    if (c === "{") return table();
    if (c === '"' || c === "'") return str();
    const m = /^(-?\d+\.?\d*(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+|true|false|nil)/.exec(src.slice(i, i + 40));
    if (!m) throw new Error(`Lua no válido en ${i}: ${src.slice(i, i + 30)}`);
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : m[0] === "nil" ? null : Number(m[0]);
  };
  const table = () => {
    i++; // {
    const obj = {};
    let n = 1;
    for (;;) {
      ws();
      if (src[i] === "}") { i++; break; }
      let key;
      if (src[i] === "[") {
        i++;
        key = value();
        ws();
        i++; // ]
        ws();
        i++; // =
      } else {
        const m = /^([A-Za-z_]\w*)\s*=/.exec(src.slice(i, i + 80));
        if (m) { key = m[1]; i += m[0].length; } else key = n++;
      }
      obj[key] = value();
      ws();
      if (src[i] === "," || src[i] === ";") i++;
    }
    return obj;
  };
  ws();
  const m = /^[A-Za-z_]\w*\s*=/.exec(src.slice(i, i + 80));
  if (m) i += m[0].length;
  return value();
}
