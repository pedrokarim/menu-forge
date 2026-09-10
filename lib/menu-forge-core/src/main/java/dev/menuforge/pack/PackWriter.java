package dev.menuforge.pack;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Écrit un {@link GeneratedPack} sur disque (dossier ou archive zip). */
public final class PackWriter {

  private PackWriter() {
  }

  /**
   * Écrit les fichiers sous {@code directory} (créé au besoin). Les fichiers
   * existants de même chemin sont écrasés ; les autres ne sont pas touchés.
   */
  public static void writeDirectory(final GeneratedPack pack, final Path directory) throws IOException {
    final Path root = directory.toAbsolutePath().normalize();
    for (final Map.Entry<String, byte[]> entry : pack.files().entrySet()) {
      final Path file = root.resolve(entry.getKey()).normalize();
      if (!file.startsWith(root)) {
        throw new IOException("chemin hors du dossier de sortie : " + entry.getKey());
      }
      Files.createDirectories(file.getParent());
      Files.write(file, entry.getValue());
    }
  }

  /** Écrit les fichiers dans une archive zip (créée ou remplacée). */
  public static void writeZip(final GeneratedPack pack, final Path zipFile) throws IOException {
    final Path parent = zipFile.toAbsolutePath().getParent();
    if (parent != null) {
      Files.createDirectories(parent);
    }
    try (OutputStream output = Files.newOutputStream(zipFile); ZipOutputStream zip = new ZipOutputStream(output)) {
      for (final Map.Entry<String, byte[]> entry : pack.files().entrySet()) {
        zip.putNextEntry(new ZipEntry(entry.getKey()));
        zip.write(entry.getValue());
        zip.closeEntry();
      }
    }
  }
}
