plugins {
  id("com.gradleup.shadow") version "8.3.6" apply false
}

allprojects {
  group = "dev.menuforge"
  version = property("menuforge_version") as String
}

subprojects {
  apply(plugin = "java-library")
  apply(plugin = "maven-publish")

  repositories {
    mavenCentral()
    maven(url = "https://repo.papermc.io/repository/maven-public/")
  }

  val junitVersion = property("junit_version") as String

  dependencies {
    "testImplementation"(platform("org.junit:junit-bom:$junitVersion"))
    "testImplementation"("org.junit.jupiter:junit-jupiter")
    "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
  }

  tasks.withType<JavaCompile>().configureEach {
    options.encoding = Charsets.UTF_8.name()
  }

  tasks.withType<Javadoc>().configureEach {
    options.encoding = Charsets.UTF_8.name()
  }

  tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty("java.awt.headless", "true")
  }

  // `./gradlew publishToMavenLocal` : pour un serveur qui consomme la lib sans
  // build composite (voir README, « Brancher un serveur »).
  extensions.configure<PublishingExtension> {
    publications {
      create<MavenPublication>("maven") {
        from(components["java"])
      }
    }
  }
}
