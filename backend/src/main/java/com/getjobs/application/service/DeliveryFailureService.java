package com.getjobs.application.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 投递失败/跳过的记录。
 *
 * <p>为什么要单独记：投递主流程里"没投出去"有好几种原因——详情页按钮找不到、
 * 岗位已关闭、发送按钮没出现、网络异常。以前这些只写日志，用户在面板上只看到
 * "投了 150 份成功 90"，剩下的 60 去哪了完全不知道。这里按原因落库，面板就能
 * 回答"为什么没投出去"。
 *
 * <p>只记录**非用户意愿**的失败；黑名单命中、AI 判定不匹配这类主动跳过不入库，
 * 否则统计会被自己配置的过滤规则污染。
 */
@Service
public class DeliveryFailureService {

    private static final Logger log = LoggerFactory.getLogger(DeliveryFailureService.class);

    /** 同一原因最多保留多少条，防止表无限膨胀（只留最近 N 条/天）。 */
    private static final int MAX_ROWS_PER_DAY = 500;

    private final JdbcTemplate jdbc;

    public DeliveryFailureService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void ensureTable() {
        try {
            jdbc.execute("""
                    CREATE TABLE IF NOT EXISTS delivery_failure (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      day TEXT NOT NULL,
                      platform TEXT NOT NULL,
                      job_name TEXT,
                      company TEXT,
                      job_url TEXT,
                      reason TEXT,
                      created_at TEXT
                    )
                    """);
            jdbc.execute("CREATE INDEX IF NOT EXISTS idx_delivery_failure_day ON delivery_failure(day, platform)");
        } catch (RuntimeException error) {
            log.warn("创建 delivery_failure 表失败，失败原因将只在日志里: {}", error.getMessage());
        }
    }

    /** 记一条失败；落库失败只打日志，绝不影响投递。 */
    public void record(String platform, String jobName, String company, String jobUrl, String reason) {
        String name = (platform == null || platform.isBlank()) ? "boss" : platform.trim().toLowerCase();
        String why = (reason == null || reason.isBlank()) ? "未知原因" : reason.trim();
        try {
            jdbc.update("""
                    INSERT INTO delivery_failure(day, platform, job_name, company, job_url, reason, created_at)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                    """,
                    LocalDate.now().toString(), name, jobName, company, jobUrl, why, LocalDateTime.now().toString());
            trimToday(name);
        } catch (RuntimeException error) {
            log.warn("写入投递失败记录失败: {}", error.getMessage());
        }
    }

    /** 只保留当天最近的 N 条，避免长时间运行把库撑大。 */
    private void trimToday(String platform) {
        try {
            jdbc.update("""
                    DELETE FROM delivery_failure
                    WHERE day = ? AND platform = ? AND id NOT IN (
                      SELECT id FROM delivery_failure WHERE day = ? AND platform = ?
                      ORDER BY id DESC LIMIT ?
                    )
                    """,
                    LocalDate.now().toString(), platform,
                    LocalDate.now().toString(), platform, MAX_ROWS_PER_DAY);
        } catch (RuntimeException ignore) {
            // 清理失败不影响主流程
        }
    }

    /** 按原因聚合今天的失败数量，多的排前面。 */
    public List<Map<String, Object>> todayByReason(String platform) {
        String name = (platform == null || platform.isBlank()) ? "boss" : platform.trim().toLowerCase();
        List<Map<String, Object>> rows = new ArrayList<>();
        try {
            rows = jdbc.query("""
                    SELECT reason, COUNT(*) AS total FROM delivery_failure
                    WHERE day = ? AND platform = ?
                    GROUP BY reason ORDER BY total DESC
                    """,
                    (rs, rowNum) -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("reason", rs.getString("reason"));
                        item.put("count", rs.getInt("total"));
                        return item;
                    },
                    LocalDate.now().toString(), name);
        } catch (RuntimeException error) {
            log.debug("读取失败统计失败: {}", error.getMessage());
        }
        return rows;
    }

    /** 今日失败总数。 */
    public int todayTotal(String platform) {
        int total = 0;
        for (Map<String, Object> row : todayByReason(platform)) {
            Object value = row.get("count");
            if (value instanceof Number number) total += number.intValue();
        }
        return total;
    }

    /** 今日失败明细（最近 N 条），给面板展示与排查用。 */
    public List<Map<String, Object>> todayList(String platform, int limit) {
        String name = (platform == null || platform.isBlank()) ? "boss" : platform.trim().toLowerCase();
        int size = Math.max(1, Math.min(limit, 200));
        try {
            return jdbc.query("""
                    SELECT job_name, company, job_url, reason, created_at FROM delivery_failure
                    WHERE day = ? AND platform = ? ORDER BY id DESC LIMIT ?
                    """,
                    (rs, rowNum) -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("jobName", rs.getString("job_name"));
                        item.put("company", rs.getString("company"));
                        item.put("jobUrl", rs.getString("job_url"));
                        item.put("reason", rs.getString("reason"));
                        item.put("createdAt", rs.getString("created_at"));
                        return item;
                    },
                    LocalDate.now().toString(), name, size);
        } catch (RuntimeException error) {
            return List.of();
        }
    }

    /** 清空今天的失败记录（重试过一轮之后想重新统计时用）。 */
    public int clearToday(String platform) {
        String name = (platform == null || platform.isBlank()) ? "boss" : platform.trim().toLowerCase();
        try {
            return jdbc.update("DELETE FROM delivery_failure WHERE day = ? AND platform = ?",
                    LocalDate.now().toString(), name);
        } catch (RuntimeException error) {
            return 0;
        }
    }
}
