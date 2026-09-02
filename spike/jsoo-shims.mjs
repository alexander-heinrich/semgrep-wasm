// Runtime shim for the 2023 Semgrep WASM bundles.
// Both the engine and the C# parser assign their primitive table to globalThis.jsoo_runtime. The parser's
// table lacks the ctypes/integers primitives that its own `Unsigned` OCaml module calls during init.
// We intercept the assignment and add implementations (uint32 as int32-shaped JS numbers, uint64 as
// jsoo int64 objects, ctypes calls that are never expected at runtime throw a clear error).
export function installJsooRuntimeShim(global = globalThis, log = () => {}) {
  let current;
  const augment = (rt) => {
    if (!rt || typeof rt !== 'object') return rt;
    const has = (n) => typeof rt[n] === 'function';
    const fail = (n) => () => { throw new Error('jsoo shim: unsupported primitive called: ' + n); };
    const i64create = rt.caml_int64_create_lo_mi_hi;
    const toBig = (x) => { // jsoo MlInt64 has lo (24 bits), mi (24 bits), hi (16 bits)
      if (typeof x === 'number') return BigInt.asUintN(64, BigInt(x));
      return (BigInt(x.hi & 0xffff) << 48n) | (BigInt(x.mi & 0xffffff) << 24n) | BigInt(x.lo & 0xffffff);
    };
    const ofBig = (b) => { b = BigInt.asUintN(64, b); return i64create(Number(b & 0xffffffn), Number((b >> 24n) & 0xffffffn), Number((b >> 48n) & 0xffffn)); };
    const u32 = (x) => x >>> 0;
    const i32 = (x) => x | 0;
    const sizes = { integers_uint_size: 4, integers_ulong_size: 8, integers_ulonglong_size: 8, integers_ushort_size: 2,
      integers_size_t_size: 8, integers_intptr_t_size: 8, integers_ptrdiff_t_size: 8, integers_uintptr_t_size: 8,
      ctypes_ldouble_size: 16, ctypes_ldouble_mant_dig: 64, ctypes_sizeof_sigset_t: 128, ctypes_alignmentof_sigset_t: 4 };
    const strOf = (s) => (typeof s === 'string' ? s : rt.caml_jsbytes_of_string ? rt.caml_jsbytes_of_string(s) : String(s));
    const mlstr = (js) => (rt.caml_string_of_jsbytes ? rt.caml_string_of_jsbytes(js) : js);
    const impl = {
      integers_unsigned_init: () => 0,
      ldouble_init: () => 0,
      integers_uint8_of_string: (s) => Number(BigInt(strOf(s)) & 0xffn),
      integers_uint16_of_string: (s) => Number(BigInt(strOf(s)) & 0xffffn),
      integers_uint32_of_string: (s) => i32(Number(BigInt(strOf(s)) & 0xffffffffn)),
      integers_uint32_to_string: (x) => mlstr(String(u32(x))),
      integers_uint32_to_hexstring: (x) => mlstr(u32(x).toString(16)),
      integers_uint32_max: () => -1,
      integers_uint32_of_int: (x) => i32(x),
      integers_uint32_to_int: (x) => u32(x),
      integers_uint32_of_int32: (x) => i32(x),
      integers_uint32_of_int64: (x) => i32(Number(toBig(x) & 0xffffffffn)),
      integers_uint32_to_int64: (x) => ofBig(BigInt(u32(x))),
      integers_uint32_add: (a, b) => i32(u32(a) + u32(b)),
      integers_uint32_sub: (a, b) => i32(u32(a) - u32(b)),
      integers_uint32_mul: (a, b) => i32(Number((BigInt(u32(a)) * BigInt(u32(b))) & 0xffffffffn)),
      integers_uint32_div: (a, b) => { if (u32(b) === 0) rt.caml_raise_zero_divide(); return i32(Math.floor(u32(a) / u32(b))); },
      integers_uint32_rem: (a, b) => { if (u32(b) === 0) rt.caml_raise_zero_divide(); return i32(u32(a) % u32(b)); },
      integers_uint32_logand: (a, b) => i32(a & b),
      integers_uint32_logor: (a, b) => i32(a | b),
      integers_uint32_logxor: (a, b) => i32(a ^ b),
      integers_uint32_shift_left: (a, n) => i32(a << n),
      integers_uint32_shift_right: (a, n) => i32(u32(a) >>> n),
      integers_uint64_of_string: (s) => ofBig(BigInt(strOf(s))),
      integers_uint64_to_string: (x) => mlstr(toBig(x).toString()),
      integers_uint64_to_hexstring: (x) => mlstr(toBig(x).toString(16)),
      integers_uint64_max: () => ofBig(0xffffffffffffffffn),
      integers_uint64_of_int: (x) => ofBig(BigInt(x)),
      integers_uint64_to_int: (x) => Number(BigInt.asIntN(32, toBig(x))),
      integers_uint64_of_int64: (x) => x,
      integers_uint64_to_int64: (x) => x,
      integers_uint64_add: (a, b) => ofBig(toBig(a) + toBig(b)),
      integers_uint64_sub: (a, b) => ofBig(toBig(a) - toBig(b)),
      integers_uint64_mul: (a, b) => ofBig(toBig(a) * toBig(b)),
      integers_uint64_div: (a, b) => { if (toBig(b) === 0n) rt.caml_raise_zero_divide(); return ofBig(toBig(a) / toBig(b)); },
      integers_uint64_rem: (a, b) => { if (toBig(b) === 0n) rt.caml_raise_zero_divide(); return ofBig(toBig(a) % toBig(b)); },
      integers_uint64_logand: (a, b) => ofBig(toBig(a) & toBig(b)),
      integers_uint64_logor: (a, b) => ofBig(toBig(a) | toBig(b)),
      integers_uint64_logxor: (a, b) => ofBig(toBig(a) ^ toBig(b)),
      integers_uint64_shift_left: (a, n) => ofBig(toBig(a) << BigInt(n)),
      integers_uint64_shift_right: (a, n) => ofBig(toBig(a) >> BigInt(n)),
    };
    // ctypes LDouble / PosixTypes module init: long double as JS double, C type tags as ctypes enum indices.
    const ldouble = {
      ctypes_ldouble_min: () => 2.2250738585072014e-308, ctypes_ldouble_max: () => Number.MAX_VALUE,
      ctypes_ldouble_epsilon: () => Number.EPSILON, ctypes_ldouble_nan: () => NaN, ctypes_ldouble_inf: () => Infinity,
      ctypes_ldouble_ninf: () => -Infinity, ctypes_ldouble_of_int: (x) => x, ctypes_ldouble_complex_make: (re, im) => ({ re, im }),
      // ctypes arithmetic enum: Int8=0 Int16=1 Int32=2 Int64=3 Uint8=4 Uint16=5 Uint32=6 Uint64=7 Float=8 Double=9
      ctypes_typeof_clock_t: () => 3, ctypes_typeof_dev_t: () => 7, ctypes_typeof_ino_t: () => 7, ctypes_typeof_mode_t: () => 6,
      ctypes_typeof_nlink_t: () => 7, ctypes_typeof_off_t: () => 3, ctypes_typeof_pid_t: () => 2, ctypes_typeof_ssize_t: () => 3,
      ctypes_typeof_time_t: () => 3, ctypes_typeof_useconds_t: () => 6,
    };
    Object.assign(impl, ldouble);
    const ctypesNames = ['ctypes_allocate', 'ctypes_bigarray_address', 'ctypes_bigarray_view', 'ctypes_block_address', 'ctypes_cstring_of_string',
      'ctypes_ldouble_complex_make', 'ctypes_ldouble_epsilon', 'ctypes_ldouble_inf', 'ctypes_ldouble_max', 'ctypes_ldouble_min', 'ctypes_ldouble_nan',
      'ctypes_ldouble_ninf', 'ctypes_ldouble_of_int', 'ctypes_memcpy', 'ctypes_read', 'ctypes_read_pointer', 'ctypes_string_of_cstring',
      'ctypes_string_of_pointer', 'ctypes_string_of_prim', 'ctypes_typeof_clock_t', 'ctypes_typeof_dev_t', 'ctypes_typeof_ino_t', 'ctypes_typeof_mode_t',
      'ctypes_typeof_nlink_t', 'ctypes_typeof_off_t', 'ctypes_typeof_pid_t', 'ctypes_typeof_ssize_t', 'ctypes_typeof_time_t', 'ctypes_typeof_useconds_t',
      'ctypes_write', 'ctypes_write_pointer', 'unix_close', 'unix_open', 'unix_read'];
    let added = 0;
    for (const [name, fn] of Object.entries(impl)) if (!has(name)) { rt[name] = fn; added++; }
    for (const [name, v] of Object.entries(sizes)) if (!has(name)) { rt[name] = () => v; added++; }
    for (const name of ctypesNames) if (!has(name)) { rt[name] = fail(name); added++; }
    log(`jsoo_runtime table assigned: ${Object.keys(rt).length} keys, ${added} shims added`);
    return rt;
  };
  Object.defineProperty(global, 'jsoo_runtime', { configurable: true, enumerable: true, get: () => current, set: (v) => { current = augment(v); } });
}
