//! Erreurs HTTP : un statut et un message en texte brut, comme `HttpError`
//! côté TypeScript.

use std::io;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpError {
    pub status: u16,
    pub message: String,
}

impl HttpError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status, self.message)
    }
}

impl std::error::Error for HttpError {}

/// Erreur d’entrée-sortie inattendue (500), au format des messages de Node :
/// `ENOENT: no such file or directory, open 'C:\…'`.
pub fn fs_error(error: &io::Error, syscall: &str, path: &str) -> HttpError {
    let (code, description) = match error.kind() {
        io::ErrorKind::NotFound => ("ENOENT", "no such file or directory"),
        io::ErrorKind::PermissionDenied => ("EPERM", "operation not permitted"),
        io::ErrorKind::AlreadyExists => ("EEXIST", "file already exists"),
        io::ErrorKind::NotADirectory => ("ENOTDIR", "not a directory"),
        io::ErrorKind::IsADirectory => ("EISDIR", "illegal operation on a directory"),
        io::ErrorKind::InvalidInput | io::ErrorKind::InvalidFilename => ("EINVAL", "invalid argument"),
        _ => ("EIO", "i/o error"),
    };
    HttpError::new(500, format!("{code}: {description}, {syscall} '{path}'"))
}
