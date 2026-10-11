import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/**
 * 正式版的簽名金鑰（金鑰和密碼都不在 repo 裡）：
 * - GitHub Actions：環境變數 DESKDO_KEYSTORE（.jks 的路徑）和 DESKDO_KEYSTORE_PASSWORD
 * - 本機：android/keystore.properties（已在 .gitignore），寫 storeFile= 和 passwordFile=（存密碼的檔案）
 * 都沒有時 release 版不簽名（只能自己用 apksigner 簽）。PKCS12 金鑰的密碼和金鑰庫密碼相同，別名是 deskdo
 */
val releaseKeystore: Pair<File, String>? = run {
    System.getenv("DESKDO_KEYSTORE")?.takeIf { it.isNotBlank() }?.let { path ->
        return@run File(path) to (System.getenv("DESKDO_KEYSTORE_PASSWORD") ?: "")
    }
    val propFile = rootProject.file("keystore.properties")
    if (!propFile.exists()) return@run null
    val props = Properties().apply { propFile.inputStream().use { load(it) } }
    val store = props.getProperty("storeFile") ?: return@run null
    val password = props.getProperty("passwordFile")?.let { File(it).readText().trim() } ?: return@run null
    File(store) to password
}

android {
    compileSdk = 37
    namespace = "dev.deskdo.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "dev.deskdo.app"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        releaseKeystore?.let { (store, password) ->
            create("release") {
                storeFile = store
                storePassword = password
                keyAlias = "deskdo"
                keyPassword = password
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
