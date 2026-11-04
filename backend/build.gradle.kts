import java.time.LocalDate
import org.springframework.boot.gradle.tasks.run.BootRun
import org.gradle.language.jvm.tasks.ProcessResources

plugins {
    java
    id("org.springframework.boot") version "3.5.16"
    // 使用 BOM(platform) 管理版本，不需要 dependency-management 插件
    // id("io.spring.dependency-management") version "1.1.6"
}

group = "com.getjobs"
version = "2.0.1"

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
}

repositories {
    // 国内镜像放前面：直连 Maven Central 在本机会在 TLS 握手阶段被掐断
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    mavenCentral()
}

dependencies {
    // 用 Spring Boot 官方 BOM 管理版本（推荐）
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.5.16"))

    // 受 BOM 管理的依赖（不写版本）
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml")
    implementation("org.apache.httpcomponents.client5:httpclient5-fluent")

    // 不在 BOM 中的依赖（写版本）
    // 1.62.0 是为了和 patchright-core 1.62.1 对齐（见 installPatchrightDriver 任务）。
    // 不要降到 1.51：patchright-core 1.51.3 的 locator.count() 是坏的（_progress is not defined）
    implementation("com.microsoft.playwright:playwright:1.62.0")
    implementation("com.baomidou:mybatis-plus-spring-boot3-starter:3.5.9")
    implementation("org.xerial:sqlite-jdbc:3.45.1.0")
    // 代码生成器（MyBatis-Plus Generator + Freemarker 模板）
    implementation("com.baomidou:mybatis-plus-generator:3.5.9")
    implementation("org.freemarker:freemarker:2.3.32")
    implementation("org.json:json:20231013")
    // DSH 插件接口：岗位导出（POI xlsx）与简历文本抽取（PDFBox / POI XWPF）
    implementation("org.apache.poi:poi-ooxml:5.2.5")
    implementation("org.apache.pdfbox:pdfbox:2.0.31")
    implementation("io.github.cdimascio:dotenv-java:2.2.0")
    implementation("jakarta.annotation:jakarta.annotation-api:2.1.1")
    implementation("org.springframework.boot:spring-boot-starter-actuator")

    // Lombok：两行不是重复声明，两个配置各管一段，缺一不可
    //   compileOnly         -> 只在编译期可见，不进运行时 classpath、不打进 jar
    //   annotationProcessor -> 注解处理器，@Data/@Slf4j 这些代码是它生成的
    // 少了 compileOnly，src/main 里的 import lombok.* 会全部编译失败；
    // 少了 annotationProcessor，编译能过但生成的方法不存在，留到运行时才炸。
    // 版本号提成变量，避免两行各写一遍、日后升级漏改。
    val lombok = "org.projectlombok:lombok:1.18.42"
    compileOnly(lombok)
    annotationProcessor(lombok)

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

// 显示已过时 API 的详细告警，便于定位并修复
tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf("-Xlint:deprecation"))
}

// 让 bootJar 里带上 build-info（可在 Actuator /info 里看到）
springBoot {
    buildInfo()
}

// ---------------------------------------------------------------------------
// Patchright driver
//
// playwright-java 本身只是个壳，真正干活的是它拉起的 Node driver 进程。
// Patchright 是打过反检测补丁的 Playwright（去掉 Runtime.enable / Console.enable 泄漏、
// 加 --disable-blink-features=AutomationControlled 等），官方只出 Python/Node/.NET，
// 没有 Java 版；但 Java 客户端支持 -Dplaywright.cli.dir 指向一个预装的 driver 目录，
// 所以可以让 Java 客户端去驱动 patchright 的 Node driver。
//
// 目录结构要求（见 com.microsoft.playwright.impl.driver.Driver）：
//     <driverDir>/package/cli.js   <- patchright-core 包内容
// node 可执行文件用本机的，通过 PLAYWRIGHT_NODEJS_PATH 传进去。
// ---------------------------------------------------------------------------
val patchrightVersion = "1.62.1"
val patchrightDriverDir = layout.buildDirectory.dir("patchright-driver")

val installPatchrightDriver = tasks.register("installPatchrightDriver") {
    group = "playwright"
    description = "下载 patchright-core 并装配成 playwright-java 能识别的 driver 目录"

    val outDir = patchrightDriverDir
    outputs.dir(outDir)

    doLast {
        val driverDir = outDir.get().asFile
        val packageDir = File(driverDir, "package")
        val marker = File(driverDir, ".version")

        if (marker.isFile && marker.readText().trim() == patchrightVersion && File(packageDir, "cli.js").isFile) {
            logger.lifecycle("patchright-core $patchrightVersion 已就绪: $packageDir")
            return@doLast
        }

        driverDir.deleteRecursively()
        driverDir.mkdirs()

        logger.lifecycle("正在下载 patchright-core@$patchrightVersion ...")
        val npm = if (System.getProperty("os.name").lowercase().contains("windows")) "npm.cmd" else "npm"
        providers.exec {
            commandLine(npm, "install", "patchright-core@$patchrightVersion",
                    "--prefix", driverDir.absolutePath, "--no-audit", "--no-fund", "--loglevel=error")
        }.result.get().assertNormalExitValue()

        val installed = File(driverDir, "node_modules/patchright-core")
        if (!File(installed, "cli.js").isFile) {
            throw GradleException("patchright-core 安装后没找到 cli.js: $installed")
        }
        // Driver 期望的是 <driverDir>/package/cli.js，把包整个搬过去
        copy {
            from(installed)
            into(packageDir)
        }
        marker.writeText(patchrightVersion)
        logger.lifecycle("patchright driver 已装配: $packageDir")
    }
}

val isWindowsOs = System.getProperty("os.name").lowercase().contains("windows")

/** 在 PATH 里找可执行文件，Windows 上要连 .cmd / .exe 一起找 */
fun findOnPath(name: String): File? {
    val candidates = if (isWindowsOs) listOf("$name.cmd", "$name.exe", "$name.bat", name) else listOf(name)
    val dirs = System.getenv("PATH")?.split(File.pathSeparator).orEmpty()
    for (dir in dirs) {
        if (dir.isBlank()) continue
        for (candidate in candidates) {
            val file = File(dir.trim(), candidate)
            if (file.isFile) return file
        }
    }
    return null
}

/** 本机 node 可执行文件路径，交给 Driver 用（PLAYWRIGHT_NODEJS_PATH） */
fun resolveNodePath(): String? = findOnPath("node")?.absolutePath

// 打包时排除旧版遗留的个人简历文件，避免随 jar 泄露
tasks.named<ProcessResources>("processResources") {
    // 旧版要求用户把个人简历放进 src/main/resources；即使被 Git 忽略，它仍会被打进 JAR。
    // 新版改为运行时上传，因此明确排除旧文件，避免个人简历随安装包泄露。
    exclude("resume", "resume.*")
}

// 正确地配置 BootRun（注意类型是 BootRun）
tasks.named<BootRun>("bootRun") {
    dependsOn(installPatchrightDriver)

    systemProperty("file.encoding", "UTF-8")
    systemProperty("sun.stdout.encoding", "UTF-8")
    systemProperty("sun.stderr.encoding", "UTF-8")
    // 示例：把当天日期传给日志或应用
    systemProperty("LOG_DATE", LocalDate.now().toString())
    // 可选：对齐端口
    // systemProperty("server.port", "8888")

    // 让 playwright-java 用 patchright 的 driver，而不是自带的 driver-bundle
    systemProperty("playwright.cli.dir", patchrightDriverDir.get().asFile.absolutePath)
    resolveNodePath()?.let { environment("PLAYWRIGHT_NODEJS_PATH", it) }
}
