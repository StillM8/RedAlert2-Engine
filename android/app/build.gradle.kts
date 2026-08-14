plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.stillm8.rtsengine"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "io.stillm8.rtsengine"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"

        manifestPlaceholders["allowCleartext"] = "false"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            manifestPlaceholders["allowCleartext"] = "true"
        }
        release {
            isMinifyEnabled = false
            manifestPlaceholders["allowCleartext"] = "false"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}
