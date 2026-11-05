package com.getjobs.application.plugin;

import com.getjobs.application.service.ConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 账号与数据管理：换招聘账号时，把上一个账号的数据导出、清空，避免两个账号的记录混在一起。
 *
 * <p>为什么不自动按账号隔离：Boss 的账号标识只能从登录态页面里拿，没有稳定的公开接口，
 * 一旦平台改版就会误判"换了账号"从而清错数据。这里选择**显式操作**——用户自己知道换了号，
 * 由他决定备份与清空，比程序猜要可靠。
 *
 * <p>清空**永不触碰**：`config`（含 API Key / 每日目标）、`cookie`（登录态）、`ai`（招呼语文案）。
 */
@RestController
@CrossOrigin(origins = "*")
public class DataAdminController {

    private static final Logger log = LoggerFactory.getLogger(DataAdminController.class);

    /** 岗位数据表（四个平台各一张）。 */
    private static final List<String> JOB_TABLES =
            List.of("boss_data", "liepin_data", "job51_data", "zhilian_data");

    /** 账号标签配置键。 */
    public static final String KEY_ACCOUNT_LABEL = "ACCOUNT_LABEL";

    /** 单表导出上限，防止一次性拉爆内存 / 浏览器。 */
    private static final int EXPORT_LIMIT = 5000;

    private final JdbcTemplate jdbc;
    private final ConfigService configService;

    public DataAdminController(JdbcTemplate jdbc, ConfigService configService) {
        this.jdbc = jdbc;
        this.configService = configService;
    }

    /** 数据概览：各表行数 + 账号标签。 */
    @GetMapping("/api/data/summary")
    public ResponseEntity<Map<String, Object>> summary() {
        Map<String, Object> counts = new LinkedHashMap<>();
        int jobs = 0;
        for (String table : JOB_TABLES) {
            int rows = count(table);
            counts.put(table, rows);
            jobs += rows;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("accountLabel", text(configService.getConfigValue(KEY_ACCOUNT_LABEL)));
        data.put("jobs", jobs);
        data.put("delivered", countWhere("boss_data", "delivery_status = '已投递'"));
        data.put("filtered", countWhere("boss_data", "delivery_status = '已过滤'"));
        data.put("failures", count("delivery_failure"));
        data.put("deliveryDays", count("delivery_daily"));
        data.put("usageDays", count("ai_usage_daily"));
        data.put("byTable", counts);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", data);
        return ResponseEntity.ok(body);
    }

    /**
     * 导出全部业务数据（JSON）。配置与登录态不在其中。
     */
    @PostMapping("/api/data/export")
    public ResponseEntity<Map<String, Object>> export() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exportedAt", LocalDateTime.now().withNano(0).toString());
        data.put("accountLabel", text(configService.getConfigValue(KEY_ACCOUNT_LABEL)));
        data.put("note", "仅含业务数据（岗位 / 投递记录 / 失败记录 / 每日统计），不含 API Key 与登录态");
        for (String table : JOB_TABLES) {
            data.put(table, selectAll(table));
        }
        data.put("delivery_failure", selectAll("delivery_failure"));
        data.put("delivery_daily", selectAll("delivery_daily"));
        data.put("ai_usage_daily", selectAll("ai_usage_daily"));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", data);
        return ResponseEntity.ok(body);
    }

    /**
     * 分范围清空。
     *
     * <p>{@code scope}：{@code jobs} 岗位 / {@code failures} 失败记录 / {@code stats} 每日统计 /
     * {@code all} 以上全部。必须显式传 {@code confirm=true}，避免误触。
     */
    @PostMapping("/api/data/clear")
    public ResponseEntity<Map<String, Object>> clear(@RequestBody Map<String, Object> request) {
        Object confirm = request == null ? null : request.get("confirm");
        boolean confirmed = Boolean.TRUE.equals(confirm)
                || "true".equalsIgnoreCase(String.valueOf(confirm));
        if (!confirmed) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("success", false);
            body.put("message", "请先确认清空（请求需带 confirm=true）");
            return ResponseEntity.badRequest().body(body);
        }
        String scope = request.get("scope") == null ? "" : String.valueOf(request.get("scope")).trim();

        Map<String, Integer> deleted = new LinkedHashMap<>();
        switch (scope) {
            case "jobs" -> clearJobs(deleted);
            case "failures" -> deleted.put("delivery_failure", delete("delivery_failure"));
            case "stats" -> {
                deleted.put("delivery_daily", delete("delivery_daily"));
                deleted.put("ai_usage_daily", delete("ai_usage_daily"));
            }
            case "all" -> {
                clearJobs(deleted);
                deleted.put("delivery_failure", delete("delivery_failure"));
                deleted.put("delivery_daily", delete("delivery_daily"));
                deleted.put("ai_usage_daily", delete("ai_usage_daily"));
            }
            default -> {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("success", false);
                body.put("message", "未知的清空范围：" + scope);
                return ResponseEntity.badRequest().body(body);
            }
        }
        int total = deleted.values().stream().mapToInt(Integer::intValue).sum();
        log.info("数据清空 scope={} 共 {} 行：{}", scope, total, deleted);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", deleted);
        body.put("message", "已清空 " + total + " 行（配置与登录态未受影响）");
        return ResponseEntity.ok(body);
    }

    /** 设置当前账号标签（只用于标记，不影响投递逻辑）。 */
    @PostMapping("/api/data/account")
    public ResponseEntity<Map<String, Object>> setAccount(@RequestBody Map<String, Object> request) {
        String label = request == null || request.get("label") == null
                ? "" : String.valueOf(request.get("label")).trim();
        if (label.length() > 40) {
            label = label.substring(0, 40);
        }
        Map<String, String> patch = new LinkedHashMap<>();
        patch.put(KEY_ACCOUNT_LABEL, label);
        configService.batchUpdateConfigs(patch);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        body.put("data", Map.of("accountLabel", label));
        body.put("message", label.isEmpty() ? "已清除账号标签" : "账号标签已保存：" + label);
        return ResponseEntity.ok(body);
    }

    private void clearJobs(Map<String, Integer> deleted) {
        for (String table : JOB_TABLES) {
            deleted.put(table, delete(table));
        }
    }

    private int count(String table) {
        try {
            Integer value = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
            return value == null ? 0 : value;
        } catch (RuntimeException error) {
            return 0;
        }
    }

    private int countWhere(String table, String where) {
        try {
            Integer value = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where, Integer.class);
            return value == null ? 0 : value;
        } catch (RuntimeException error) {
            return 0;
        }
    }

    private int delete(String table) {
        try {
            return jdbc.update("DELETE FROM " + table);
        } catch (RuntimeException error) {
            log.warn("清空表 {} 失败: {}", table, error.getMessage());
            return 0;
        }
    }

    private List<Map<String, Object>> selectAll(String table) {
        try {
            List<Map<String, Object>> rows = new ArrayList<>(
                    jdbc.queryForList("SELECT * FROM " + table + " LIMIT " + EXPORT_LIMIT));
            return rows;
        } catch (RuntimeException error) {
            return List.of();
        }
    }

    private String text(String value) {
        return value == null ? "" : value;
    }
}
