//! Serveur HTTP local (127.0.0.1 uniquement) : l’API sous `/api` et, en
//! option, les fichiers de l’interface (appli Tauri : même origine pour la
//! page et l’API, donc ni CORS ni protocole maison).
//!
//! Utilisé par `studio-api` (mode navigateur, port 5174, Vite « proxifie »
//! `/api`) et par la coquille Tauri (port libre choisi à l’exécution).
//!
//! Protections contre un site tiers ouvert dans le navigateur, faites ici (au
//! niveau du transport) et non dans [`Backend::handle`] :
//! - l’en-tête `Host` doit être local (contre le « DNS rebinding ») ;
//! - l’en-tête `Origin`, s’il est présent, doit être local ; `Origin: null`
//!   (iframe isolée, redirection intersite, `file://`) est refusé ;
//! - toute requête autre que GET/HEAD vers `/api` doit porter l’en-tête
//!   `X-Menu-Forge: 1` ([`CSRF_HEADER`]) : un formulaire ou une image d’un site
//!   tiers ne peut pas l’ajouter, et un `fetch` intersite qui l’ajoute exige
//!   un contrôle préalable CORS que ce serveur n’accorde jamais.
//!
//! Chaque refus est un 403 texte.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use crate::paths::{decode_path, strip_api_prefix, url_pathname};
use crate::{Backend, Request, Response};

/// Nombre de fils qui traitent les requêtes.
const WORKERS: usize = 8;

/// En-tête exigé (valeur `1`) sur toute requête autre que GET/HEAD vers `/api`.
pub const CSRF_HEADER: &str = "X-Menu-Forge";

/// Fichier statique de l’interface.
#[derive(Clone, Debug)]
pub struct StaticFile {
    pub body: Vec<u8>,
    pub content_type: String,
}

/// Source des fichiers de l’interface : reçoit un chemin décodé commençant
/// par `/` (`/index.html`, `/assets/app.js`) et renvoie le fichier s’il existe.
pub type StaticFiles = Arc<dyn Fn(&str) -> Option<StaticFile> + Send + Sync>;

/// Serveur en cours d’exécution.
pub struct ServerHandle {
    port: u16,
    server: Arc<tiny_http::Server>,
    stopping: Arc<AtomicBool>,
    workers: Vec<JoinHandle<()>>,
}

impl ServerHandle {
    /// Port réellement écouté (utile avec le port 0).
    pub fn port(&self) -> u16 {
        self.port
    }

    /// `http://127.0.0.1:<port>`.
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Arrête le serveur : les requêtes en cours se terminent, puis les fils
    /// s’arrêtent et le port est libéré.
    pub fn shutdown(self) {
        self.stopping.store(true, Ordering::SeqCst);
        for _ in &self.workers {
            self.server.unblock();
        }
        for worker in self.workers {
            let _ = worker.join();
        }
    }

    /// Bloque jusqu’à l’arrêt du serveur.
    pub fn wait(self) {
        for worker in self.workers {
            let _ = worker.join();
        }
    }
}

/// Lance le serveur sur `127.0.0.1:<port>` (`0` : port libre choisi par le
/// système) et renvoie aussitôt. `static_files` : fichiers de l’interface,
/// servis hors de `/api`, avec repli sur `/index.html` pour les routes de
/// l’application (chemin sans extension).
pub fn serve(backend: Arc<Backend>, port: u16, static_files: Option<StaticFiles>) -> io::Result<ServerHandle> {
    let server = tiny_http::Server::http(("127.0.0.1", port))
        .map_err(|error| io::Error::new(io::ErrorKind::AddrInUse, format!("127.0.0.1:{port} : {error}")))?;
    let port = server.server_addr().to_ip().map(|address| address.port()).unwrap_or(port);
    let server = Arc::new(server);
    let stopping = Arc::new(AtomicBool::new(false));
    let workers = (0..WORKERS)
        .map(|_| {
            let server = Arc::clone(&server);
            let backend = Arc::clone(&backend);
            let static_files = static_files.clone();
            let stopping = Arc::clone(&stopping);
            thread::spawn(move || loop {
                match server.recv() {
                    Ok(request) => respond(&backend, static_files.as_ref(), request),
                    Err(_) if stopping.load(Ordering::SeqCst) => break,
                    Err(error) => eprintln!("[menu-forge] requête non reçue : {error}"),
                }
                if stopping.load(Ordering::SeqCst) {
                    break;
                }
            })
        })
        .collect();
    Ok(ServerHandle { port, server, stopping, workers })
}

/// Nom d’hôte sans le port (`localhost:5174` → `localhost`, `[::1]:80` → `[::1]`).
fn host_name(value: &str) -> &str {
    if value.starts_with('[') {
        return value.split_inclusive(']').next().unwrap_or(value);
    }
    value.split(':').next().unwrap_or(value)
}

fn is_local_host(host: &str) -> bool {
    matches!(host_name(host).to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]")
}

/// Origine admise : locale ; `null` (origine opaque) ne l’est jamais.
fn is_local_origin(origin: &str) -> bool {
    if origin == "null" {
        return false;
    }
    let authority = origin.split_once("://").map(|(_, rest)| rest).unwrap_or(origin);
    is_local_host(authority.split('/').next().unwrap_or(authority))
}

/// Protège le serveur d’un site tiers ouvert dans le navigateur : l’en-tête
/// `Host` doit être local (contre le « DNS rebinding ») et l’origine, si
/// présente, aussi (contre les requêtes intersites, POST/PUT compris).
fn check_origin(request: &tiny_http::Request) -> Result<(), Response> {
    for header in request.headers() {
        let value = header.value.as_str();
        if header.field.equiv("Host") && !is_local_host(value) {
            return Err(Response::text(403, "Hôte non autorisé"));
        }
        if header.field.equiv("Origin") && !is_local_origin(value) {
            return Err(Response::text(403, "Origine non autorisée"));
        }
    }
    Ok(())
}

/// Requête qui modifie quelque chose (autre que GET/HEAD) : exige `X-Menu-Forge: 1`.
fn check_csrf(request: &tiny_http::Request) -> Result<(), Response> {
    let method = request.method().as_str();
    if method == "GET" || method == "HEAD" {
        return Ok(());
    }
    let marked = request.headers().iter().any(|header| header.field.equiv(CSRF_HEADER) && header.value.as_str() == "1");
    if marked { Ok(()) } else { Err(Response::text(403, "En-tête X-Menu-Forge manquant")) }
}

/// Fichier de l’interface, avec repli sur `index.html` pour les routes de
/// l’application (dernier segment sans point).
fn static_response(files: &StaticFiles, method: &str, url: &str) -> tiny_http::Response<io::Cursor<Vec<u8>>> {
    if method != "GET" && method != "HEAD" {
        return to_http(Response::text(405, &format!("Méthode non prise en charge : {method}")));
    }
    let path = match decode_path(&url_pathname(url)) {
        Ok(path) => path,
        Err(_) => return to_http(Response::text(400, "Chemin illisible")),
    };
    let wanted = if path == "/" { "/index.html".to_owned() } else { path };
    let last_segment = wanted.rsplit('/').next().unwrap_or("");
    let file = files(&wanted).or_else(|| (!last_segment.contains('.')).then(|| files("/index.html")).flatten());
    match file {
        Some(file) => {
            let mut http = tiny_http::Response::from_data(file.body);
            add_header(&mut http, "Content-Type", &file.content_type);
            add_header(&mut http, "Cache-Control", "no-cache");
            add_header(&mut http, "X-Content-Type-Options", "nosniff");
            http
        }
        None => to_http(Response::text(404, &format!("Fichier introuvable : {wanted}"))),
    }
}

fn add_header(http: &mut tiny_http::Response<io::Cursor<Vec<u8>>>, name: &str, value: &str) {
    match tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
        Ok(header) => http.add_header(header),
        Err(()) => eprintln!("[menu-forge] en-tête ignoré : {name}"),
    }
}

fn to_http(response: Response) -> tiny_http::Response<io::Cursor<Vec<u8>>> {
    let mut http = tiny_http::Response::from_data(response.body).with_status_code(response.status);
    if let Some(content_type) = response.content_type {
        add_header(&mut http, "Content-Type", content_type);
    }
    for (name, value) in response.headers {
        add_header(&mut http, name, value);
    }
    http
}

fn respond(backend: &Backend, static_files: Option<&StaticFiles>, mut request: tiny_http::Request) {
    let http = match check_origin(&request) {
        Err(response) => to_http(response),
        Ok(()) => match strip_api_prefix(request.url()) {
            Some(path) => match check_csrf(&request) {
                Err(response) => to_http(response),
                Ok(()) => {
                    let mut body = Vec::new();
                    let response = match request.as_reader().read_to_end(&mut body) {
                        Ok(_) => backend.handle(&Request::new(request.method().as_str(), path, body)),
                        Err(_) => Response::text(400, "Corps de requête illisible"),
                    };
                    to_http(response)
                }
            },
            None => match static_files {
                Some(files) => static_response(files, request.method().as_str(), request.url()),
                None => to_http(Response::text(404, &format!("Hors de l’API : {}", request.url()))),
            },
        },
    };
    if let Err(error) = request.respond(http) {
        eprintln!("[menu-forge] réponse non envoyée : {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_hosts() {
        for host in ["localhost", "localhost:5174", "127.0.0.1:1", "[::1]:5173", "LOCALHOST"] {
            assert!(is_local_host(host), "{host}");
        }
        for host in ["example.com", "127.0.0.2", "localhost.evil.com", "[::2]"] {
            assert!(!is_local_host(host), "{host}");
        }
    }

    #[test]
    fn local_origins() {
        for origin in ["http://localhost:5173", "http://127.0.0.1:5174", "tauri://localhost"] {
            assert!(is_local_origin(origin), "{origin}");
        }
        for origin in ["null", "https://evil.example", "http://localhost.evil.com"] {
            assert!(!is_local_origin(origin), "{origin}");
        }
    }
}
