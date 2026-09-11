// Plugin Paper autonome « MenuForge ». Il embarque le noyau, mais pas Gson ni
// Adventure (fournis par Paper) : aucune relocalisation de net.kyori, les appels
// Adventure natifs de Paper fonctionnent donc tels quels.

plugins {
  `java-library`
  id("com.gradleup.shadow")
}

tasks.withType<JavaCompile>().configureEach {
  options.release.set(21)
}

dependencies {
  compileOnly("io.papermc.paper:paper-api:${property("paper_api_version")}")
  // `api` : l’API publique (MenuForgeApi) expose des types du noyau
  // (MenuDefinition, GeneratedPack), un consommateur doit donc les voir.
  api(project(":menu-forge-core")) {
    exclude(group = "com.google.code.gson", module = "gson")
  }

  // Serveur simulé pour les tests (MockBukkit bâti sur paper-api 1.20.6, la
  // version minimale visée).
  testImplementation("com.github.seeseemelk:MockBukkit-v1.20:${property("mockbukkit_version")}")
}

tasks.processResources {
  filteringCharset = Charsets.UTF_8.name()
  val props = mapOf("version" to project.version)
  inputs.properties(props)
  filesMatching("plugin.yml") {
    expand(props)
  }
}

tasks.named<com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar>("shadowJar") {
  archiveBaseName.set("MenuForge")
  archiveClassifier.set("")
  dependencies {
    exclude(dependency("com.google.code.gson:gson"))
  }
}

tasks.named("assemble") {
  dependsOn("shadowJar")
}
