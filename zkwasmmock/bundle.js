import { Simulator } from "./simulator.js";
import { swapEndian } from "./utils.js";

let zkwasmSimulator = "";

export function setupZKWasmSimulator(simulator) {
  zkwasmSimulator = simulator;
}

async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.assign(Object.create(globalThis), imports.env || {}, {
      "console.log"(text) {
        // ~lib/bindings/dom/console.log(~lib/string/String) => void
        text = __liftString(text >>> 0);
        console.log(text);
      },
      require(x) {
        // sdk/zkwasm/require1(i32) => i64
        Simulator.require(x);
      },
      wasm_input(x) {
        // lib/common/zkwasm/wasm_input(i32) => i64
        return zkwasmSimulator.wasm_input(x) || 0n;
      },
      wasm_write_context(arg) {
        console.log('wasm write context: ' + swapEndian(BigInt.asUintN(64, arg).toString(16)));
      },
      wasm_read_context() {
        return zkwasmSimulator.wasm_read_context() || 0n;
      },
      js_log(arg) {
        // to compatible with c-wasm
        console.log(arg);
      },
      js_log_u64(arg) {
        // to compatible with c-wasm
        console.log(BigInt.asUintN(64, arg));
      },
      // printDec(arg) {
      //   process.stdout.write(arg);
      // },
      // printHex(arg) {
      //   process.stdout.write(arg.toString(16).padStart(2, '0'));
      // },
      // printSp() {
      //   process.stdout.write(' ');
      // },
      // printLn() {
      //   console.log();
      // },
      // c_log(arg) {
      //   // to compatible with c-wasm
      //   console.log('c_log: ', arg);
      // },
    }),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf(
    {
      asmain(rawreceipts, matched_event_offsets) {
        // lib/main_local/asmain(~lib/typedarray/Uint8Array, ~lib/typedarray/Uint32Array) => ~lib/typedarray/Uint8Array
        rawreceipts = __retain(
          __lowerTypedArray(Uint8Array, 4, 0, rawreceipts) || __notnull(),
        );
        matched_event_offsets =
          __lowerTypedArray(Uint32Array, 5, 2, matched_event_offsets) ||
          __notnull();
        try {
          return __liftTypedArray(
            Uint8Array,
            exports.asmain(rawreceipts, matched_event_offsets) >>> 0,
          );
        } finally {
          __release(rawreceipts);
        }
      },
    },
    exports,
  );
  function __liftString(pointer) {
    if (!pointer) return null;
    const end =
        (pointer + new Uint32Array(memory.buffer)[(pointer - 4) >>> 2]) >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let start = pointer >>> 1,
      string = "";
    while (end - start > 1024)
      string += String.fromCharCode(
        ...memoryU16.subarray(start, (start += 1024)),
      );
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  function __liftTypedArray(constructor, pointer) {
    if (!pointer) return null;
    return new constructor(
      memory.buffer,
      __getU32(pointer + 4),
      __dataview.getUint32(pointer + 8, true) / constructor.BYTES_PER_ELEMENT,
    ).slice();
  }
  function __lowerTypedArray(constructor, id, align, values) {
    if (values == null) return 0;
    const length = values.length,
      buffer = exports.__pin(exports.__new(length << align, 1)) >>> 0,
      header = exports.__new(12, id) >>> 0;
    __setU32(header + 0, buffer);
    __dataview.setUint32(header + 4, buffer, true);
    __dataview.setUint32(header + 8, length << align, true);
    new constructor(memory.buffer, buffer, length).set(values);
    exports.__unpin(buffer);
    return header;
  }
  const refcounts = new Map();
  function __retain(pointer) {
    if (pointer) {
      const refcount = refcounts.get(pointer);
      if (refcount) refcounts.set(pointer, refcount + 1);
      else refcounts.set(exports.__pin(pointer), 1);
    }
    return pointer;
  }
  function __release(pointer) {
    if (pointer) {
      const refcount = refcounts.get(pointer);
      if (refcount === 1) exports.__unpin(pointer), refcounts.delete(pointer);
      else if (refcount) refcounts.set(pointer, refcount - 1);
      else
        throw Error(
          `invalid refcount '${refcount}' for reference '${pointer}'`,
        );
    }
  }
  function __notnull() {
    throw TypeError("value must not be null");
  }
  let __dataview = new DataView(memory.buffer);
  function __setU32(pointer, value) {
    try {
      __dataview.setUint32(pointer, value, true);
    } catch {
      __dataview = new DataView(memory.buffer);
      __dataview.setUint32(pointer, value, true);
    }
  }
  function __getU32(pointer) {
    try {
      return __dataview.getUint32(pointer, true);
    } catch {
      __dataview = new DataView(memory.buffer);
      return __dataview.getUint32(pointer, true);
    }
  }
  return adaptedExports;
}

export const instantiateWasm = async (wasmUnit8Array) => {
    return instantiate(
      await (async () => {
        return globalThis.WebAssembly.compile(
          wasmUnit8Array.buffer,
        )
      })(),
      {},
    )
  }