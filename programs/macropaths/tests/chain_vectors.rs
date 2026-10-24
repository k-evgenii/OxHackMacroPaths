//! Rust chain matches `tests/vectors.json` from main: `commitment` and `chain` rows.
//! Expected digests are read from that file, not typed here.

use macropaths::chain::{dataset_id, dataset_preimage, end_hash, obs_hash};

const VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/vectors.json"
));

#[test]
fn chain_matches_vectors() {
    let root = parse_json(VECTORS);
    let commitment = get(&root, "commitment");
    let n = as_u32(get(commitment, "N"));
    let window = as_arr(get(commitment, "window"));
    assert_eq!(window.len(), 2);

    let levels: Vec<String> = as_arr(get(&root, "levels"))
        .iter()
        .map(|row| as_str(get(row, "level")).to_string())
        .collect();
    let level_refs: Vec<&str> = levels.iter().map(String::as_str).collect();

    let series_id = as_str(get(commitment, "series_id"));
    let source_url = as_str(get(commitment, "source_url"));
    let window_start = as_str(&window[0]);
    let window_end = as_str(&window[1]);
    let transform_id = as_str(get(commitment, "transform_id"));
    let first_period_id = as_u32(get(commitment, "first_period_id"));
    let k = as_num(get(commitment, "K"));
    let d_cap = as_u64(get(commitment, "D_cap"));
    let a_cap = as_u64(get(commitment, "A_cap"));

    let pre = dataset_preimage(
        series_id,
        source_url,
        window_start,
        window_end,
        transform_id,
        &level_refs,
        n,
        first_period_id,
        k,
        d_cap,
        a_cap,
    );
    assert_eq!(
        pre.len(),
        as_u64(get(commitment, "dataset_preimage_len")) as usize
    );
    assert_eq!(
        hex_encode(&pre),
        as_str(get(commitment, "dataset_preimage_hex")),
        "dataset preimage"
    );

    let id = dataset_id(
        series_id,
        source_url,
        window_start,
        window_end,
        transform_id,
        &level_refs,
        n,
        first_period_id,
        k,
        d_cap,
        a_cap,
    );
    assert_eq!(hex_encode(&id), as_str(get(commitment, "dataset_id")));

    let c_n = decode_hex_32(as_str(get(commitment, "C_N")));
    let c_0 = decode_hex_32(as_str(get(commitment, "C_0")));
    assert_eq!(end_hash(&id, n), c_n, "end_hash == C_N");

    let rows = as_arr(get(&root, "chain"));
    assert_eq!(rows.len(), n as usize);
    let mut parsed = Vec::with_capacity(rows.len());
    for (idx, row) in rows.iter().enumerate() {
        let i = as_u32(get(row, "i"));
        assert_eq!(i, idx as u32, "chain row order");
        parsed.push((
            i,
            as_u32(get(row, "period_id")),
            as_num(get(row, "value")),
            decode_hex_32(as_str(get(row, "C_i"))),
        ));
    }
    assert_eq!(parsed[0].3, c_0, "chain[0].C_i == C_0");

    for i in 0..parsed.len() {
        let next = if i + 1 < parsed.len() {
            parsed[i + 1].3
        } else {
            c_n
        };
        let (index, period_id, value, c_i) = parsed[i];
        let got = obs_hash(&id, index, period_id, value, &next);
        assert_eq!(got, c_i, "obs_hash({index}) == C_i");
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex_32(s: &str) -> [u8; 32] {
    assert_eq!(s.len(), 64, "digest hex length");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("hex");
    }
    out
}

#[derive(Debug)]
enum J {
    Num(i64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

fn get<'a>(v: &'a J, key: &str) -> &'a J {
    match v {
        J::Obj(pairs) => pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, val)| val)
            .unwrap_or_else(|| panic!("missing key {key}")),
        _ => panic!("expected object for key {key}"),
    }
}

fn as_str(v: &J) -> &str {
    match v {
        J::Str(s) => s,
        _ => panic!("expected string"),
    }
}

fn as_num(v: &J) -> i64 {
    match v {
        J::Num(n) => *n,
        _ => panic!("expected number"),
    }
}

fn as_u32(v: &J) -> u32 {
    u32::try_from(as_num(v)).expect("u32")
}

fn as_u64(v: &J) -> u64 {
    u64::try_from(as_num(v)).expect("u64")
}

fn as_arr(v: &J) -> &[J] {
    match v {
        J::Arr(a) => a,
        _ => panic!("expected array"),
    }
}

fn parse_json(text: &str) -> J {
    let mut p = P {
        s: text.as_bytes(),
        i: 0,
    };
    let v = p.value();
    p.skip();
    assert_eq!(p.i, p.s.len(), "trailing junk at {}", p.i);
    v
}

struct P<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn skip(&mut self) {
        while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }

    fn peek(&mut self) -> u8 {
        self.skip();
        self.s[self.i]
    }

    fn bump(&mut self) -> u8 {
        let c = self.peek();
        self.i += 1;
        c
    }

    fn value(&mut self) -> J {
        match self.peek() {
            b'{' => self.object(),
            b'[' => self.array(),
            b'"' => J::Str(self.string()),
            b'-' | b'0'..=b'9' => J::Num(self.number()),
            other => panic!("bad json at {}: {}", self.i, other as char),
        }
    }

    fn object(&mut self) -> J {
        assert_eq!(self.bump(), b'{');
        let mut pairs = Vec::new();
        if self.peek() == b'}' {
            self.i += 1;
            return J::Obj(pairs);
        }
        loop {
            let key = self.string();
            assert_eq!(self.bump(), b':');
            pairs.push((key, self.value()));
            match self.bump() {
                b',' => continue,
                b'}' => break,
                other => panic!("expected ',' or '}}', got {}", other as char),
            }
        }
        J::Obj(pairs)
    }

    fn array(&mut self) -> J {
        assert_eq!(self.bump(), b'[');
        let mut items = Vec::new();
        if self.peek() == b']' {
            self.i += 1;
            return J::Arr(items);
        }
        loop {
            items.push(self.value());
            match self.bump() {
                b',' => continue,
                b']' => break,
                other => panic!("expected ',' or ']', got {}", other as char),
            }
        }
        J::Arr(items)
    }

    fn string(&mut self) -> String {
        assert_eq!(self.bump(), b'"');
        let mut buf = Vec::new();
        loop {
            let c = self.s[self.i];
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let e = self.s[self.i];
                    self.i += 1;
                    match e {
                        b'"' | b'\\' | b'/' => buf.push(e),
                        b'b' => buf.push(0x08),
                        b'f' => buf.push(0x0c),
                        b'n' => buf.push(b'\n'),
                        b'r' => buf.push(b'\r'),
                        b't' => buf.push(b'\t'),
                        b'u' => {
                            let hex = std::str::from_utf8(&self.s[self.i..self.i + 4]).unwrap();
                            self.i += 4;
                            let cp = u32::from_str_radix(hex, 16).unwrap();
                            let ch = char::from_u32(cp).expect("unicode escape");
                            buf.extend(ch.encode_utf8(&mut [0; 4]).as_bytes());
                        }
                        other => panic!("bad escape {}", other as char),
                    }
                }
                _ => buf.push(c),
            }
        }
        String::from_utf8(buf).expect("utf8 string")
    }

    fn number(&mut self) -> i64 {
        self.skip();
        let start = self.i;
        if self.s[self.i] == b'-' {
            self.i += 1;
        }
        let digits = self.i;
        while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
            self.i += 1;
        }
        assert!(self.i > digits, "bad number");
        let text = std::str::from_utf8(&self.s[start..self.i]).unwrap();
        text.parse()
            .unwrap_or_else(|_| panic!("number out of i64: {text}"))
    }
}
