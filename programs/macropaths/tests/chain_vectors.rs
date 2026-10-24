//! The commitment chain in `chain.rs` matches `tests/vectors.json` `chain`.
//! Expected digests come from that file (written by `tests/make_vectors.py`).

use macropaths::chain::{dataset_id, end_hash, obs_hash};

const VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/vectors.json"
));

#[test]
fn chain_matches_vectors() {
    let root = parse_json(VECTORS);
    let provenance = get(&root, "provenance");
    let id = dataset_id(
        as_str(get(provenance, "source_url")),
        as_str(get(provenance, "retrieved_at")),
        as_str(get(provenance, "sha256_of_raw")),
    );

    let chain = get(&root, "chain");
    assert_eq!(
        hex_encode(&id),
        as_str(get(chain, "dataset_id")),
        "dataset_id"
    );

    let commitments = as_arr(get(chain, "commitments"))
        .iter()
        .map(|v| decode_hex_32(as_str(v)))
        .collect::<Vec<_>>();
    assert_eq!(commitments.len(), 49, "C_0 .. C_48");

    let period_ids = as_arr(get(chain, "period_ids"))
        .iter()
        .map(|v| as_u32(v))
        .collect::<Vec<_>>();
    assert_eq!(period_ids.len(), 48);

    let rows = as_arr(get(&root, "rows"));
    assert_eq!(rows.len(), 48);
    let mut xs = Vec::with_capacity(48);
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(as_num(get(row, "t")), i as i64, "row t");
        let date = as_str(get(row, "date"));
        let year: u32 = date[..4].parse().expect("year");
        let month: u32 = date[5..7].parse().expect("month");
        assert_eq!(year * 100 + month, period_ids[i], "period_id[{i}]");
        xs.push(as_num(get(row, "x")));
    }

    let terminal = end_hash(&id, 48);
    assert_eq!(terminal, commitments[48], "end_hash == C_48");

    for i in (0..48).rev() {
        let got = obs_hash(&id, i as u32, period_ids[i], xs[i], &commitments[i + 1]);
        assert_eq!(got, commitments[i], "obs_hash({i}) == C_{i}");
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
    let n = as_num(v);
    u32::try_from(n).expect("u32")
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
            assert_eq!(self.bump(), b':', "expected ':'");
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
