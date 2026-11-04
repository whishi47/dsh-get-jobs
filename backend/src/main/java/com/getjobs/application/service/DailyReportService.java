package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.hc.client5.http.fluent.Request;
import org.apache.hc.core5.http.ContentType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 每日投递汇报：把「今天投了多少、AI 花了多少」总结成一段文字，推到企业微信。
 *
 * <p>为什么不在投递结束时顺手推：投递可能一天跑好几轮，也可能半夜跑完，
 * 用户需要的是**固定时间的一条汇总**，而不是刷屏。所以这里用定时任务，
 * 每天在 {@code DAILY_REPORT_TIME} 推一次，并用 {@code DAILY_REPORT_LAST}
 * 记下最后推送日期，避免同一分钟被触发两次、或重启后重复推。
 *
 * <p>开关独立于 {@code BOT_IS_SEND}：那个开关管的是投递过程中的实时通知，
 * 日报是另一件事，只看 {@code DAILY_REPORT_ENABLED} 和 {@code HOOK_URL}。
 */
@Service
public class DailyReportService {

    private static final Logger log = LoggerFactory.getLogger(DailyReportService.class);

    public static final String KEY_ENABLED = "DAILY_REPORT_ENABLED";
    public static final String KEY_TIME = "DAILY_REPORT_TIME";
    public static final String KEY_LAST = "DAILY_REPORT_LAST";

    private final JdbcTemplate jdbc;
    private final ConfigService configService;
    private final DeliveryQuotaService quotaService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public DailyReportService(JdbcTemplate jdbc,
                              ConfigService configService,
                              DeliveryQuotaService quotaService) {
        this.jdbc = jdbc;
        this.configService = configService;
        this.quotaService = quotaService;
    }

    /** 是否开启日报。 */
    public boolean enabled() {
        String raw = configService.getConfigValue(KEY_ENABLED);
        return raw != null && ("1".equals(raw.trim()) || "true".equalsIgnoreCase(raw.trim()));
    }

    /** 推送时间，形如 {@code 21:30}；非法时回退 21:30。 */
    public String reportTime() {
        String raw = configService.getConfigValue(KEY_TIME);
        if (raw == null || raw.isBlank()) return "21:30";
        return raw.trim().replace('：', ':');
    }

    /** 最近一次成功推送的日期。 */
    public String lastSentDay() {
        String raw = configService.getConfigValue(KEY_LAST);
        return raw == null ? "" : raw.trim();
    }

    /**
     * 生成汇报正文。
     *
     * <p>纯函数：只读库、不发网络请求，所以既能给定时任务用，也能给面板预览用。
     */
    public String buildReport() {
        Map<String, Integer> delivered = quotaService.todayByPlatform();
        int total = delivered.values().stream().filter(java.util.Objects::nonNull).mapToInt(Integer::intValue).sum();
        int target = quotaService.dailyTarget();
        int calls = 0;
        int tokens = 0;
        try {
            Map<String, Object> usage = jdbc.queryForMap(
                    "SELECT calls, total_tokens FROM ai_usage_daily WHERE day = ?", LocalDate.now().toString());
            calls = usage.get("calls") instanceof Number n ? n.intValue() : 0;
            tokens = usage.get("total_tokens") instanceof Number n ? n.intValue() : 0;
        } catch (RuntimeException ignore) {
            // 今天还没调用过 AI，正常
        }

        StringBuilder text = new StringBuilder();
        text.append("📊 今日投递汇报 ").append(LocalDate.now()).append('\n');
        text.append("投递成功：").append(total).append(" 份");
        if (!delivered.isEmpty()) {
            text.append("（");
            boolean first = true;
            for (Map.Entry<String, Integer> entry : delivered.entrySet()) {
                if (entry.getValue() == null || entry.getValue() <= 0) continue;
                if (!first) text.append(" / ");
                text.append(platformLabel(entry.getKey())).append(' ').append(entry.getValue());
                first = false;
            }
            text.append("）");
        }
        text.append('\n');
        if (target > 0) {
            text.append("今日目标：").append(target).append(" 份，剩余 ")
                    .append(Math.max(target - total, 0)).append(" 份\n");
        }
        text.append("AI 调用：").append(calls).append(" 次 / ").append(tokens).append(" tokens");
        return text.toString();
    }

    /** 汇报相关的状态快照，给面板展示。 */
    public Map<String, Object> status() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("enabled", enabled());
        value.put("time", reportTime());
        value.put("lastSent", lastSentDay());
        value.put("hookConfigured", hookUrl() != null && !hookUrl().isBlank());
        value.put("preview", buildReport());
        return value;
    }

    /**
     * 立即推送一次。
     *
     * @return 结果说明；成功时带 {@code sent=true}
     */
    public Map<String, Object> pushNow() {
        Map<String, Object> result = new LinkedHashMap<>();
        String hook = hookUrl();
        if (hook == null || hook.isBlank()) {
            result.put("sent", false);
            result.put("message", "未配置企业微信 webhook（设置 → AI 设置 → 接口与推送）");
            return result;
        }
        String text = buildReport();
        try {
            String payload = objectMapper.writeValueAsString(Map.of(
                    "msgtype", "text",
                    "text", Map.of("content", text)));
            String response = Request.post(hook)
                    .bodyString(payload, ContentType.APPLICATION_JSON)
                    .execute()
                    .returnContent()
                    .asString();
            log.info("日报推送响应: {}", response);
            markSent();
            result.put("sent", true);
            result.put("message", "已推送到企业微信");
            result.put("text", text);
            return result;
        } catch (Exception error) {
            log.warn("日报推送失败: {}", error.getMessage());
            result.put("sent", false);
            result.put("message", "推送失败：" + error.getMessage());
            return result;
        }
    }

    /**
     * 每分钟检查一次：到点且今天没推过，就推一条。
     *
     * <p>用「每分钟比对 HH:mm」而不是 cron 表达式，是因为推送时间来自数据库配置，
     * 用户随时可能改；cron 是启动时固定的，改配置得重启才生效。
     */
    @Scheduled(cron = "0 * * * * *")
    public void tick() {
        try {
            if (!enabled()) return;
            LocalTime point;
            try {
                point = LocalTime.parse(reportTime());
            } catch (RuntimeException error) {
                return; // 配置写错了就当没开，不要每分钟抛一次异常
            }
            LocalTime now = LocalTime.now().withSecond(0).withNano(0);
            if (now.getHour() != point.getHour() || now.getMinute() != point.getMinute()) return;
            if (LocalDate.now().toString().equals(lastSentDay())) return;
            pushNow();
        } catch (RuntimeException error) {
            log.warn("日报定时任务异常: {}", error.getMessage());
        }
    }

    private void markSent() {
        try {
            configService.batchUpdateConfigs(Map.of(KEY_LAST, LocalDate.now().toString()));
        } catch (RuntimeException error) {
            log.warn("记录日报推送日期失败: {}", error.getMessage());
        }
    }

    private String hookUrl() {
        return configService.getConfigValue("HOOK_URL");
    }

    private String platformLabel(String platform) {
        return switch (platform == null ? "" : platform) {
            case "boss" -> "Boss";
            case "liepin" -> "猎聘";
            case "51job" -> "51job";
            case "zhilian" -> "智联";
            default -> platform == null ? "未知" : platform;
        };
    }

    /** 面板上「上次推送」为空时不好看，统一转成一个可读值。 */
    public String lastSentLabel() {
        String day = lastSentDay();
        if (day.isBlank()) return "从未推送";
        return day + (day.equals(LocalDate.now().toString()) ? "（今天已推）" : "");
    }

    /** 当前时间是否已过今天的推送点（面板提示用）。 */
    public boolean pastTodayPoint() {
        try {
            LocalTime point = LocalTime.parse(reportTime());
            return LocalDateTime.now().toLocalTime().isAfter(point);
        } catch (RuntimeException error) {
            return false;
        }
    }
}
