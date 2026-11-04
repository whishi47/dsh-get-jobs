package com.getjobs.application.plugin;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 只读的诊断接口：脱敏配置 + 环境就绪度。
 *
 * <p>两个接口的共同前提是**不回传任何秘密**。密钥类值只露头尾各 4 位，
 * webhook 里的 key 参数一并打码；就绪检查只报告"有没有配"和"文件在不在"，
 * 不发起网络请求，避免设置页因为一次超时卡住。
 */
@RestController
@CrossOrigin(origins = "*")
public class SettingsController {

    /** 值需要打码的配置键。 */
    private static final List<String> SECRET_KEYS = List.of("API_KEY", "HOOK_URL", "TOKEN", "SECRET");

    private static final Map<String, String> CATEGORY_LABELS = Map.of(
            "ai", "AI 接口",
            "bot", "企业微信推送",
            "delivery", "投递配额与报表"
    );

    private final JdbcTemplate jdbc;

    public SettingsController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 按 category 分组的脱敏配置。 */
    @GetMapping("/api/config/masked")
    public ResponseEntity<Map<String, Object>> masked() {
        Map<String, Object> grouped = new LinkedHashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT config_key, config_value, category FROM config ORDER BY category, config_key");
        for (Map<String, Object> row : rows) {
            String key = asText(row.get("config_key"));
            String category = asText(row.get("category"));
            String label = CATEGORY_LABELS.getOrDefault(category, category.isEmpty() ? "其他" : category);
            @SuppressWarnings("unchecked")
            Map<String, Object> bucket = (Map<String, Object>) grouped.computeIfAbsent(label, ignored -> new LinkedHashMap<>());
            bucket.put(key, isSecret(key) ? mask(asText(row.get("config_value"))) : asText(row.get("config_value")));
        }
        return ResponseEntity.ok(grouped);
    }

    /**
     * 删除一个自定义配置键。
     *
     * <p>只放行 category = custom 的行：BASE_URL / API_KEY / MODEL / HOOK_URL
     * 这些核心键被投递链路依赖，删掉一个整条流水线就哑了，而且用户在
     * 设置页里很难自查。自定义键是用户自己加的，删了也不影响既有功能。
     */
    @DeleteMapping("/api/config/{key}")
    public ResponseEntity<Map<String, Object>> deleteConfig(@PathVariable String key) {
        Map<String, Object> body = new LinkedHashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT category FROM config WHERE config_key = ?", key);
        if (rows.isEmpty()) {
            body.put("success", false);
            body.put("message", "配置键不存在: " + key);
            return ResponseEntity.status(404).body(body);
        }
        String category = asText(rows.get(0).get("category"));
        if (!"custom".equals(category)) {
            body.put("success", false);
            body.put("message", "核心配置不允许删除，直接清空值即可");
            return ResponseEntity.badRequest().body(body);
        }
        jdbc.update("DELETE FROM config WHERE config_key = ?", key);
        body.put("success", true);
        body.put("message", "已删除: " + key);
        return ResponseEntity.ok(body);
    }

    /** 环境就绪度：数据库、配置、Playwright 驱动、各平台登录态。 */
    @GetMapping("/api/system/ready")
    public ResponseEntity<Map<String, Object>> ready() {
        List<Map<String, Object>> checks = new ArrayList<>();
        checks.add(checkDatabase());
        checks.add(checkAiConfig());
        checks.add(checkPlaywright());
        checks.add(checkLoginState());

        boolean ready = checks.stream().allMatch(item -> Boolean.TRUE.equals(item.get("ok")));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ready", ready);
        body.put("checks", checks);
        body.put("projectDir", Paths.get("").toAbsolutePath().toString());
        return ResponseEntity.ok(body);
    }

    private Map<String, Object> checkDatabase() {
        try {
            Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM boss_data", Integer.class);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("boss_data", total == null ? 0 : total);
            return check("database", "本地数据库", true, "SQLite 可读，boss_data " + (total == null ? 0 : total) + " 行", detail);
        } catch (RuntimeException error) {
            return check("database", "本地数据库", false, "读不到 db/getjobs.db：" + error.getMessage(), Map.of());
        }
    }

    private Map<String, Object> checkAiConfig() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT config_key, config_value FROM config WHERE category = 'ai'");
        Map<String, String> values = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            values.put(asText(row.get("config_key")), asText(row.get("config_value")));
        }
        boolean hasBase = !values.getOrDefault("BASE_URL", "").isEmpty();
        boolean hasKey = !values.getOrDefault("API_KEY", "").isEmpty();
        boolean hasModel = !values.getOrDefault("MODEL", "").isEmpty();
        boolean ok = hasBase && hasKey && hasModel;

        StringBuilder message = new StringBuilder(ok ? "已配置 " : "缺少 ");
        if (!ok) {
            List<String> missing = new ArrayList<>();
            if (!hasBase) missing.add("BASE_URL");
            if (!hasKey) missing.add("API_KEY");
            if (!hasModel) missing.add("MODEL");
            message.append(String.join("、", missing));
        } else {
            message.append(values.get("MODEL"));
        }

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("baseUrl", values.getOrDefault("BASE_URL", ""));
        detail.put("model", values.getOrDefault("MODEL", ""));
        detail.put("apiKey", mask(values.getOrDefault("API_KEY", "")));
        return check("ai", "大模型接口", ok, message.toString(), detail);
    }

    private Map<String, Object> checkPlaywright() {
        Path root = Paths.get("").toAbsolutePath();
        Path driver = root.resolve("build/patchright-driver/package/cli.js");
        Path browserData = root.resolve("browser-data");
        boolean driverOk = Files.isRegularFile(driver);
        boolean browserOk = Files.isDirectory(browserData);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("driver", driverOk);
        detail.put("browserData", browserOk);
        String message;
        if (driverOk && browserOk) {
            message = "驱动与浏览器数据目录就绪";
        } else if (!driverOk && !browserOk) {
            message = "驱动和 browser-data 都没有，首次跑投递会自动下载";
        } else if (!driverOk) {
            message = "缺少 patchright 驱动，首次跑投递会自动装配";
        } else {
            message = "缺少 browser-data 目录，首次登录会创建";
        }
        return check("playwright", "浏览器驱动", driverOk && browserOk, message, detail);
    }

    private Map<String, Object> checkLoginState() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT platform, LENGTH(cookie_value) AS size FROM cookie ORDER BY platform");
        Map<String, Object> detail = new LinkedHashMap<>();
        List<String> loggedIn = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String platform = asText(row.get("platform"));
            Object size = row.get("size");
            boolean present = size instanceof Number number && number.longValue() > 0;
            detail.put(platform, present);
            if (present) loggedIn.add(platform);
        }
        boolean ok = !loggedIn.isEmpty();
        String message = ok
                ? "已登录：" + String.join("、", loggedIn)
                : "还没有任何平台登录记录，投递前先在「运行」页扫码";
        return check("login", "平台登录", ok, message, detail);
    }

    private static Map<String, Object> check(String id, String label, boolean ok, String message, Map<String, Object> detail) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("label", label);
        item.put("ok", ok);
        item.put("message", message);
        item.put("detail", detail);
        return item;
    }

    private static boolean isSecret(String key) {
        String upper = key == null ? "" : key.toUpperCase();
        return SECRET_KEYS.stream().anyMatch(upper::contains);
    }

    /**
     * 打码：短值全掩，长值露头尾各 4 位。
     *
     * <p>webhook 是个 URL，key 藏在查询参数里，所以先把 {@code key=xxx} 段落单独打码，
     * 否则整串长度足够，头尾各露 4 位仍可能把 key 的一截放出去。
     */
    static String mask(String value) {
        if (value == null || value.isEmpty()) return "";
        String scrubbed = value.replaceAll("(?i)(key|token|secret)=([^&]+)", "$1=****");
        if (!scrubbed.equals(value)) return scrubbed;
        if (value.length() <= 8) return "****";
        return value.substring(0, 4) + "****" + value.substring(value.length() - 4);
    }

    private static String asText(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
