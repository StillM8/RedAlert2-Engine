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
            buildConfigField("String", "GAME_MOD", "\"\"")
        }
        create("yr") {
            dimension = "game"
            applicationId = "com.ammaar.yurirevengeandroid"
            buildConfigField("String", "GAME_ENGINE", "\"yr\"")
            buildConfigField("String", "GAME_MOD", "\"\"")
        }
        create("mo") {
            dimension = "game"
            applicationId = "com.ammaar.mentalomegaandroid"
            buildConfigField("String", "GAME_ENGINE", "\"mo\"")
            // Mental Omega is distributed to the Android client as a complete
            // standalone game directory. It is the selected game profile, not
            // a second OPFS mod directory layered on top of that same folder.
            buildConfigField("String", "GAME_MOD", "\"\"")
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
