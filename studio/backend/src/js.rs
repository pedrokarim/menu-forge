//! Reproduction fidèle de quelques comportements de JavaScript dont dépend la
//! forme exacte des réponses : `JSON.stringify` (ordre des clés, format des
//! nombres, échappements), l’ordre de `Array.prototype.sort()` sans comparateur
//! et `String.prototype.localeCompare`.

use std::cmp::Ordering;
use std::sync::LazyLock;

use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed, CollatorPreferences};
use serde_json::{Map, Value};

/// Collation racine d’ICU, celle qu’utilise `localeCompare` sous `fr-FR`
/// (le français n’a pas de règles propres, hors `fr-CA`).
static COLLATOR: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| {
    Collator::try_new(CollatorPreferences::default(), CollatorOptions::default())
        .expect("données de collation intégrées")
});

/// Équivalent de `a.localeCompare(b)` (sensibilité « variant », sans option).
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    COLLATOR.compare(a, b)
}

/// Ordre du `.sort()` par défaut : comparaison des unités de code UTF-16.
pub fn utf16_compare(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Équivalent de `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None, 0);
    out
}

/// Équivalent de `JSON.stringify(value, null, 2)`.
pub fn stringify_pretty(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, Some(2), 0);
    out
}

/// Format d’un nombre selon `Number.prototype.toString` (chiffres les plus
/// courts qui relisent la même valeur, notation exponentielle hors de
/// [1e-7, 1e21[).
pub fn format_number(value: f64) -> String {
    if !value.is_finite() {
        return "null".to_owned();
    }
    if value == 0.0 {
        return "0".to_owned(); // y compris -0
    }
    let exp_form = format!("{:e}", value.abs());
    let (mantissa, exponent) = exp_form.split_once('e').expect("notation exponentielle");
    let exponent: i32 = exponent.parse().expect("exposant");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent + 1;
    let mut out = String::new();
    if value < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

/// Clé « indice de tableau » : JavaScript les énumère en premier, par ordre
/// numérique croissant, avant les autres clés (dans leur ordre d’insertion).
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    let value: u64 = key.parse().ok()?;
    (value <= 4_294_967_294).then_some(value as u32)
}

/// Clés d’un objet dans l’ordre d’énumération de JavaScript.
fn ordered_entries(map: &Map<String, Value>) -> Vec<(&String, &Value)> {
    let mut indexed: Vec<(u32, (&String, &Value))> = Vec::new();
    let mut named: Vec<(&String, &Value)> = Vec::new();
    for entry in map.iter() {
        match array_index(entry.0) {
            Some(index) => indexed.push((index, entry)),
            None => named.push(entry),
        }
    }
    indexed.sort_by_key(|(index, _)| *index);
    indexed.into_iter().map(|(_, entry)| entry).chain(named).collect()
}

fn write_string(out: &mut String, text: &str) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn newline(out: &mut String, indent: Option<usize>, depth: usize) {
    if let Some(width) = indent {
        out.push('\n');
        out.extend(std::iter::repeat_n(' ', width * depth));
    }
}

fn write_value(out: &mut String, value: &Value, indent: Option<usize>, depth: usize) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&format_number(number.as_f64().unwrap_or(f64::NAN))),
        Value::String(text) => write_string(out, text),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (position, (key, item)) in ordered_entries(map).into_iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                newline(out, indent, depth + 1);
                write_string(out, key);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, depth + 1);
            }
            newline(out, indent, depth);
            out.push('}');
        }
    }
}

/// Équivalent de `JSON.parse(buffer.toString('utf8'))` : les octets UTF-8
/// invalides deviennent U+FFFD, comme dans Node.
pub fn parse_lossy(bytes: &[u8]) -> Option<Value> {
    serde_json::from_str(&String::from_utf8_lossy(bytes)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_match_javascript() {
        let cases = [
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (123e-20, "1.23e-18"),
            (-0.0, "0"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (100.0, "100"),
            (1.5, "1.5"),
            (-7.25, "-7.25"),
            (12345678901234567890.0, "12345678901234567000"),
            (0.1 + 0.2, "0.30000000000000004"),
        ];
        for (value, expected) in cases {
            assert_eq!(format_number(value), expected, "{value}");
        }
    }

    #[test]
    fn integer_keys_come_first() {
        let value: Value = serde_json::from_str(
            r#"{"b":1,"2":2,"a":3,"1":4,"01":5,"4294967295":6,"4294967294":7}"#,
        )
        .unwrap();
        assert_eq!(
            stringify(&value),
            r#"{"1":4,"2":2,"4294967294":7,"b":1,"a":3,"01":5,"4294967295":6}"#
        );
    }

    #[test]
    fn pretty_matches_javascript() {
        let value = serde_json::json!({"a": [1, {"b": []}], "c": {}, "d": "\u{e9}\u{1}\n"});
        let expected = concat!(
            "{\n  \"a\": [\n    1,\n    {\n      \"b\": []\n    }\n  ],\n  \"c\": {},\n  \"d\": \"\u{e9}",
            "\\",
            "u0001\\n\"\n}"
        );
        assert_eq!(stringify_pretty(&value), expected);
    }

    #[test]
    fn collation_matches_icu() {
        let mut words = vec![
            "a_b", "a-b", "a/b", "a.b", "aB", "ab", "Ab", "a0", "a:b", "a b", "a~b", "a$b", "é", "e", "f",
            "a(b", "a#b", "a!b",
        ];
        words.sort_by(|a, b| locale_compare(a, b));
        // Ordre relevé avec Node 24 (ICU 77, locale fr-FR).
        assert_eq!(
            words.join("  "),
            "a b  a_b  a-b  a:b  a!b  a.b  a(b  a/b  a#b  a~b  a$b  a0  ab  aB  Ab  e  é  f"
        );
    }

    #[test]
    fn utf16_order_differs_from_code_points() {
        // U+FF5E (une unité UTF-16) passe après U+1F600 (paire de substituts D83D…).
        assert_eq!(utf16_compare("\u{1F600}", "\u{FF5E}"), Ordering::Less);
    }
}
