plugins {
    id("com.android.application")
}

val releaseKeystorePath = System.getenv("IOS_NOTES_ANDROID_KEYSTORE_PATH")
val releaseKeystorePassword = System.getenv("IOS_NOTES_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = System.getenv("IOS_NOTES_ANDROID_KEY_ALIAS") ?: "ios-imap-notes"
val releaseKeyPassword = System.getenv("IOS_NOTES_ANDROID_KEY_PASSWORD") ?: releaseKeystorePassword

android {
    namespace = "net.zp1.iosimapnotes"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.zp1.iosimapnotes"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (
            !releaseKeystorePath.isNullOrBlank()
            && !releaseKeystorePassword.isNullOrBlank()
            && !releaseKeyPassword.isNullOrBlank()
        ) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/LICENSE.md"
            excludes += "/META-INF/NOTICE.md"
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

dependencies {
    implementation("com.sun.mail:android-mail:1.6.7")
    implementation("com.sun.mail:android-activation:1.6.7")

    testImplementation("junit:junit:4.13.2")
}
