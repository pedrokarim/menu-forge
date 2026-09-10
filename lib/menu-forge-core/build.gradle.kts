// Noyau autonome : format, gabarits, conditions, composition du titre, génération du pack.
// Aucune dépendance Bukkit/Paper : seul Gson est autorisé.

plugins {
  `java-library`
}

java {
  withSourcesJar()
}

tasks.withType<JavaCompile>().configureEach {
  options.release.set(17)
}

dependencies {
  api("com.google.code.gson:gson:${property("gson_version")}")
}
