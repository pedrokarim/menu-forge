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

// Fixture de parité partagée avec le studio (ParityFixtureTest) :
// `-PparityUpdate=true` réécrit ses fichiers attendus.
tasks.test {
  val parityDir = layout.projectDirectory.dir("src/test/resources/parity").asFile.absolutePath
  val parityUpdate = providers.gradleProperty("parityUpdate").orElse("false").get()
  inputs.property("parityUpdate", parityUpdate)
  systemProperty("menuforge.parity.dir", parityDir)
  systemProperty("menuforge.parity.update", parityUpdate)
}
