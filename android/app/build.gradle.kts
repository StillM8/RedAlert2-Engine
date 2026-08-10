plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ammaar.ra2android"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "com.ammaar.ra2android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        manifestPlaceholders["allowCleartext"] = "false"
    }

    flavorDimensions += "game"
    productFlavors {
        create("ra2") {
            dimension = "game"
            applicationId = "com.ammaar.ra2android"
            buildConfigField("String", "GAME_ENGINE", "\"ra2\"")
            buildConfigField("String", "GAME_PROFILE", "\"ra2\"")
        }
        create("yr") {
            dimension = "game"
            applicationId = "com.ammaar.yurirevengeandroid"
            buildConfigField("String", "GAME_ENGINE", "\"yr\"")
            buildConfigField("String", "GAME_PROFILE", "\"yr\"")
        }
        create("mo") {
            dimension = "game"
            applicationId = "com.ammaar.mentalomegaandroid"
            // Mental Omega is a Yuri's Revenge profile, not a third
            // simulation engine. The APK remains separate, but the shared
            // runtime only needs to select YR plus this profile.
            buildConfigField("String", "GAME_ENGINE", "\"yr\"")
            buildConfigField("String", "GAME_PROFILE", "\"mental-omega\"")
            // The APK is a standalone client, while the selected resources are
            // a complete MO + Yuri's Revenge installation. This is a profile,
            // not a second OPFS mod directory layered on top of the folder.
        }
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
