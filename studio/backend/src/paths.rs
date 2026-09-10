//! Chemins de fichiers et d’URL, avec la sémantique de Node (`path.resolve`,
//! `path.relative`, `new URL(...).pathname`, `decodeURIComponent`) pour que les
//! deux backends acceptent et refusent exactement les mêmes requêtes.

use crate::error::HttpError;

/// Style de chemins : Windows (`\`, lecteurs, insensible à la casse) ou POSIX.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Windows,
    Posix,
}

impl Style {
    /// Style de la plateforme courante.
    pub const NATIVE: Style = if cfg!(windows) { Style::Windows } else { Style::Posix };

    fn is_sep(self, c: char) -> bool {
        c == '/' || (self == Style::Windows && c == '\\')
    }

    fn sep(self) -> char {
        match self {
            Style::Windows => '\\',
            Style::Posix => '/',
        }
    }
}

/// `normalizeString` de Node : résout `.` et `..`, sans séparateur final.
fn normalize_segments(path: &str, allow_above_root: bool, style: Style) -> String {
    let mut out: Vec<&str> = Vec::new();
    for segment in path.split(|c| style.is_sep(c)) {
        match segment {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|last| *last != "..") {
                    out.pop();
                } else if allow_above_root {
                    out.push("..");
                }
            }
            other => out.push(other),
        }
    }
    out.join(&style.sep().to_string())
}

fn current_dir() -> String {
    std::env::current_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_owned())
}

/// Racine d’un chemin Windows : (longueur de la racine, lecteur, absolu ?).
fn windows_root(path: &str) -> (usize, String, bool) {
    let chars: Vec<char> = path.chars().collect();
    let style = Style::Windows;
    let len = chars.len();
    if len == 0 {
        return (0, String::new(), false);
    }
    let first = chars[0];
    if len == 1 {
        return if style.is_sep(first) { (1, String::new(), true) } else { (0, String::new(), false) };
    }
    if style.is_sep(first) {
        if !style.is_sep(chars[1]) {
            return (1, String::new(), true);
        }
        // Chemin UNC : \\serveur\partage
        let mut j = 2;
        let mut last = j;
        while j < len && !style.is_sep(chars[j]) {
            j += 1;
        }
        if j < len && j != last {
            let first_part: String = chars[last..j].iter().collect();
            last = j;
            while j < len && style.is_sep(chars[j]) {
                j += 1;
            }
            if j < len && j != last {
                last = j;
                while j < len && !style.is_sep(chars[j]) {
                    j += 1;
                }
                if j == len || j != last {
                    let share: String = chars[last..j].iter().collect();
                    let root_len: usize = chars[..j].iter().map(|c| c.len_utf8()).sum();
                    return (root_len, format!("\\\\{first_part}\\{share}"), true);
                }
            }
        }
        return (1, String::new(), true);
    }
    if first.is_ascii_alphabetic() && chars[1] == ':' {
        let device: String = chars[..2].iter().collect();
        if len > 2 && style.is_sep(chars[2]) {
            return (3, device, true);
        }
        return (2, device, false);
    }
    (0, String::new(), false)
}

/// `path.win32.resolve(...segments)`.
fn resolve_windows(segments: &[&str]) -> String {
    let mut resolved_device = String::new();
    let mut resolved_tail = String::new();
    let mut resolved_absolute = false;
    let mut index = segments.len() as isize - 1;
    while index >= -1 {
        let path = if index >= 0 {
            let segment = segments[index as usize];
            if segment.is_empty() {
                index -= 1;
                continue;
            }
            segment.to_owned()
        } else if resolved_device.is_empty() {
            current_dir()
        } else {
            let cwd = current_dir();
            let matches = cwd.len() >= 3
                && cwd[..2].eq_ignore_ascii_case(&resolved_device)
                && Style::Windows.is_sep(cwd[2..].chars().next().unwrap_or(' '));
            if matches { cwd } else { format!("{resolved_device}\\") }
        };
        let (root_end, device, is_absolute) = windows_root(&path);
        if !device.is_empty() {
            if !resolved_device.is_empty() {
                if device.to_lowercase() != resolved_device.to_lowercase() {
                    index -= 1;
                    continue;
                }
            } else {
                resolved_device = device;
            }
        }
        if resolved_absolute {
            if !resolved_device.is_empty() {
                break;
            }
        } else {
            resolved_tail = format!("{}\\{}", &path[root_end..], resolved_tail);
            resolved_absolute = is_absolute;
            if is_absolute && !resolved_device.is_empty() {
                break;
            }
        }
        index -= 1;
    }
    let tail = normalize_segments(&resolved_tail, !resolved_absolute, Style::Windows);
    if resolved_absolute {
        format!("{resolved_device}\\{tail}")
    } else {
        let joined = format!("{resolved_device}{tail}");
        if joined.is_empty() { ".".to_owned() } else { joined }
    }
}

/// `path.posix.resolve(...segments)`.
fn resolve_posix(segments: &[&str]) -> String {
    let mut resolved = String::new();
    let mut absolute = false;
    let cwd = current_dir();
    let mut all: Vec<&str> = vec![&cwd];
    all.extend_from_slice(segments);
    for segment in all.iter().rev() {
        if segment.is_empty() {
            continue;
        }
        resolved = format!("{segment}/{resolved}");
        if segment.starts_with('/') {
            absolute = true;
            break;
        }
    }
    let tail = normalize_segments(&resolved, !absolute, Style::Posix);
    if absolute { format!("/{tail}") } else if tail.is_empty() { ".".to_owned() } else { tail }
}

/// `path.resolve(...segments)` dans le style donné.
pub fn resolve_with(style: Style, segments: &[&str]) -> String {
    match style {
        Style::Windows => resolve_windows(segments),
        Style::Posix => resolve_posix(segments),
    }
}

/// `path.resolve(...segments)` de la plateforme courante.
pub fn resolve(segments: &[&str]) -> String {
    resolve_with(Style::NATIVE, segments)
}

/// `path.dirname` d’un chemin déjà résolu.
pub fn dirname(path: &str) -> String {
    let style = Style::NATIVE;
    match path.rfind(|c| style.is_sep(c)) {
        Some(0) => path[..1].to_owned(),
        Some(position) if style == Style::Windows && position == 2 && path.as_bytes()[1] == b':' => {
            path[..3].to_owned()
        }
        Some(position) => path[..position].to_owned(),
        None => ".".to_owned(),
    }
}

/// `path.join(base, relative)` pour une base déjà absolue.
pub fn join(base: &str, relative: &str) -> String {
    resolve(&[base, relative])
}

/// Préfixe de lecteur Windows (`C:`), refusé d’emblée.
fn has_drive_prefix(relative: &str) -> bool {
    let bytes = relative.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// Comme `insideRoot` : résout `relative` sous `root` et refuse toute sortie
/// du dossier (même test que `path.relative(...).startsWith('..')`). En plus
/// de Node, un préfixe de lecteur (`C:x`) est refusé sous Windows.
pub fn inside_root_with(style: Style, root: &str, relative: &str) -> Result<String, HttpError> {
    let outside = || HttpError::new(400, "Chemin en dehors du dossier autorisé");
    if style == Style::Windows && has_drive_prefix(relative) {
        return Err(outside());
    }
    let target = resolve_with(style, &[root, relative]);
    let root = resolve_with(style, &[root]);
    let (root_cmp, target_cmp) = match style {
        Style::Windows => (root.to_lowercase(), target.to_lowercase()),
        Style::Posix => (root.clone(), target.clone()),
    };
    if target_cmp == root_cmp {
        return Ok(target);
    }
    let prefix = if root_cmp.ends_with(style.sep()) { root_cmp } else { format!("{root_cmp}{}", style.sep()) };
    match target_cmp.strip_prefix(&prefix) {
        // `path.relative` renverrait ce reste : Node refuse aussi `..truc`.
        Some(rest) if !rest.starts_with("..") => Ok(target),
        _ => Err(outside()),
    }
}

/// [`inside_root_with`] dans le style de la plateforme courante.
pub fn inside_root(root: &str, relative: &str) -> Result<String, HttpError> {
    inside_root_with(Style::NATIVE, root, relative)
}

/// Caractères du « path percent-encode set » du standard URL.
fn needs_encoding(c: char) -> bool {
    let code = c as u32;
    !(0x20..=0x7e).contains(&code) || matches!(c, ' ' | '"' | '#' | '<' | '>' | '?' | '^' | '`' | '{' | '}')
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for c in segment.chars() {
        if needs_encoding(c) {
            let mut buffer = [0u8; 4];
            for byte in c.encode_utf8(&mut buffer).bytes() {
                out.push_str(&format!("%{byte:02X}"));
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// `new URL(target, 'http://localhost').pathname` : coupe la requête et le
/// fragment, traite `\` comme `/`, résout `.`/`..` (y compris `%2e`) et encode
/// les caractères qui doivent l’être.
pub fn url_pathname(target: &str) -> String {
    let cleaned: String = target.chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
    let trimmed = cleaned.trim_matches(|c: char| c <= ' ');
    let without_query = match trimmed.find(['?', '#']) {
        Some(position) => &trimmed[..position],
        None => trimmed,
    };
    let slashed = without_query.replace('\\', "/");
    // `//hôte/chemin` : l’autorité est ignorée, comme le ferait `new URL`.
    let path = match slashed.strip_prefix("//") {
        Some(rest) => match rest.find('/') {
            Some(position) => rest[position..].to_owned(),
            None => String::new(),
        },
        None => slashed,
    };
    let path = path.strip_prefix('/').unwrap_or(&path);
    let parts: Vec<&str> = path.split('/').collect();
    let mut out: Vec<String> = Vec::new();
    if !(parts.len() == 1 && parts[0].is_empty()) {
        for (position, part) in parts.iter().enumerate() {
            let is_last = position + 1 == parts.len();
            let lower = part.to_ascii_lowercase();
            if matches!(lower.as_str(), ".." | ".%2e" | "%2e." | "%2e%2e") {
                out.pop();
                if is_last {
                    out.push(String::new());
                }
            } else if matches!(lower.as_str(), "." | "%2e") {
                if is_last {
                    out.push(String::new());
                }
            } else {
                out.push(encode_segment(part));
            }
        }
    }
    format!("/{}", out.join("/"))
}

/// `decodeURIComponent` : toute séquence `%` mal formée ou tout UTF-8
/// invalide est une erreur (500 « URI malformed », comme dans Node).
pub fn decode_component(encoded: &str) -> Result<String, HttpError> {
    let malformed = || HttpError::new(500, "URI malformed");
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut position = 0;
    while position < bytes.len() {
        if bytes[position] == b'%' {
            let hex = bytes.get(position + 1..position + 3).ok_or_else(malformed)?;
            let text = std::str::from_utf8(hex).map_err(|_| malformed())?;
            if !text.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(malformed());
            }
            out.push(u8::from_str_radix(text, 16).map_err(|_| malformed())?);
            position += 3;
        } else {
            out.push(bytes[position]);
            position += 1;
        }
    }
    String::from_utf8(out).map_err(|_| malformed())
}

/// `decodePath` : décode segment par segment (les `/` restent des séparateurs,
/// mais un `%2F` décodé en devient un, comme dans le serveur TypeScript).
pub fn decode_path(encoded: &str) -> Result<String, HttpError> {
    let segments: Result<Vec<String>, HttpError> = encoded.split('/').map(decode_component).collect();
    Ok(segments?.join("/"))
}

/// Préfixe `/api` à la manière de `connect` (`app.use('/api', ...)`) : renvoie
/// la cible restante, ou `None` si la requête ne concerne pas l’API.
pub fn strip_api_prefix(target: &str) -> Option<String> {
    const ROUTE: &str = "/api";
    let pathname_end = target.find('?').unwrap_or(target.len());
    let pathname = &target[..pathname_end];
    if pathname.len() < ROUTE.len() || !pathname[..ROUTE.len()].eq_ignore_ascii_case(ROUTE) {
        return None;
    }
    match pathname[ROUTE.len()..].chars().next() {
        None | Some('/') | Some('.') => {}
        Some(_) => return None,
    }
    let rest = &target[ROUTE.len()..];
    Some(if rest.starts_with('/') { rest.to_owned() } else { format!("/{rest}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = r"C:\ws\textures";

    #[test]
    fn resolve_like_node_win32() {
        assert_eq!(resolve_with(Style::Windows, &[r"C:\a\b", "../c/./d"]), r"C:\a\c\d");
        assert_eq!(resolve_with(Style::Windows, &["C:/a/b/"]), r"C:\a\b");
        assert_eq!(resolve_with(Style::Windows, &[r"C:\a", r"\x"]), r"C:\x");
        assert_eq!(resolve_with(Style::Windows, &[r"C:\a", "C:x"]), r"C:\a\x");
        assert_eq!(resolve_with(Style::Windows, &[r"C:\a", r"D:\x\.."]), r"D:\");
        assert_eq!(resolve_with(Style::Windows, &[r"C:\a", r"\\srv\share\x"]), r"\\srv\share\x");
        assert_eq!(resolve_with(Style::Posix, &["/a/b", "../c"]), "/a/c");
    }

    #[test]
    fn traversal_is_refused() {
        let refused = [
            "../x.png",
            "a/../../x.png",
            r"..\x.png",
            r"a\..\..\x.png",
            r"C:\Windows\x.png",
            "C:x.png",
            "c:/x.png",
            r"\x.png",
            "/x.png",
            r"\\srv\share\x.png",
            "..x.png", // même refus que `path.relative(...).startsWith('..')`
            r"..\..\ws\textures2\x.png",
        ];
        for relative in refused {
            assert!(inside_root_with(Style::Windows, ROOT, relative).is_err(), "{relative}");
        }
        let accepted = [("a/b.png", r"C:\ws\textures\a\b.png"), ("a/../b.png", r"C:\ws\textures\b.png"), ("", ROOT)];
        for (relative, expected) in accepted {
            assert_eq!(inside_root_with(Style::Windows, ROOT, relative).unwrap(), expected);
        }
        // Insensible à la casse sous Windows, comme `path.win32.relative`.
        assert!(inside_root_with(Style::Windows, ROOT, r"..\TEXTURES\x.png").is_ok());
        assert!(inside_root_with(Style::Posix, "/ws/t", "../t2/x.png").is_err());
        assert!(inside_root_with(Style::Posix, "/ws/t", "../t/x.png").is_ok());
        assert!(inside_root_with(Style::Posix, "/ws/t", "/etc/passwd").is_err());
    }

    #[test]
    fn encoded_separators_are_decoded_then_checked() {
        let decoded = decode_path("..%2F..%2Fx.png").unwrap();
        assert_eq!(decoded, "../../x.png");
        assert!(inside_root_with(Style::Windows, ROOT, &decoded).is_err());
        let decoded = decode_path("a%5C..%5C..%5Cx.png").unwrap();
        assert!(inside_root_with(Style::Windows, ROOT, &decoded).is_err());
        let decoded = decode_path("C%3A%2Fx.png").unwrap();
        assert!(inside_root_with(Style::Windows, ROOT, &decoded).is_err());
    }

    #[test]
    fn decode_component_is_strict() {
        assert_eq!(decode_component("a%20b%C3%A9").unwrap(), "a bé");
        assert!(decode_component("%E0%A4%A").is_err());
        assert!(decode_component("%zz").is_err());
        assert!(decode_component("%C3").is_err());
        assert!(decode_component("%").is_err());
    }

    #[test]
    fn pathname_like_whatwg_url() {
        let cases = [
            ("/workspace?x=1", "/workspace"),
            ("/textures/%2e%2e/x.png", "/x.png"),
            ("/a/%2e./b", "/b"),
            ("/a/.%2E/b", "/b"),
            ("/a/..\\b", "/b"),
            ("/a/b/..", "/a/"),
            ("/a/.", "/a/"),
            ("//foo/bar", "/bar"),
            ("/x#y", "/x"),
            ("/%7e%41", "/%7e%41"),
            ("/a b/x^y`z{}|<>\"é~", "/a%20b/x%5Ey%60z%7B%7D|%3C%3E%22%C3%A9~"),
            ("", "/"),
        ];
        for (input, expected) in cases {
            assert_eq!(url_pathname(input), expected, "{input}");
        }
    }

    #[test]
    fn api_prefix_like_connect() {
        assert_eq!(strip_api_prefix("/api/workspace?x").as_deref(), Some("/workspace?x"));
        assert_eq!(strip_api_prefix("/API/workspace").as_deref(), Some("/workspace"));
        assert_eq!(strip_api_prefix("/api").as_deref(), Some("/"));
        assert_eq!(strip_api_prefix("/api?x").as_deref(), Some("/?x"));
        assert_eq!(strip_api_prefix("/apix/workspace"), None);
        assert_eq!(strip_api_prefix("/index.html"), None);
    }
}
