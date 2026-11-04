package com.getjobs.application.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * 每日投递配额：按天统计成功投递数，达到目标后让投递自动收工。
 *
 * <p>为什么要单独建表而不是从 {@code boss_data} 里数：那张表记的是"抓到的岗位"，
 * 投递状态改动的时间点不一定是投递发生的时间点（补数据、手工改状态都会污染计数）。
 * 这里由投递成功的那一刻显式打点，一个岗位一次，跨平台共用一张表，所以面板上的
 * 「今日已投」和配额判断永远一致。
 *
 * <p>配额分两级，**任一到达就停**：
 * <ul>
 *   <li>{@code DELIVERY_DAILY_TARGET} —— 所有平台加起来的合计上限；</li>
 *   <li>{@code DELIVERY_DAILY_TARGET_<PLATFORM>} —— 单个平台自己的上限，
 *       比如 Boss 投 30 份、猎聘投 10 份。0 表示该平台不单独限制。</li>
 * </ul>
 * 两级都配时取更严格的那个，实际剩余额度 = min(合计剩余, 本平台剩余)。
 */
@Service
public class DeliveryQuotaService {

    private static final Logger log = LoggerFactory.getLogger(DeliveryQuotaService.class);

    /** 每日投递总目标（跨平台合计），0 或负数 = 不限。 */
    public static final String KEY_DAILY_TARGET = "DELIVERY_DAILY_TARGET";
    /** 允许投递的时间段，形如 {@code 9-23}；留空 = 全天。 */
    public static final String KEY_WORK_HOURS = "DELIVERY_WORK_HOURS";
    /** 触发安全校验后自动冷却多少分钟；缺省 30，显式 0 = 不冷却。 */
    public static final String KEY_COOLDOWN_MINUTES = "DELIVERY_COOLDOWN_MINUTES";
    /** 冷却截止时间（ISO 本地时间），由后端写入，面板只读。 */
    public static final String KEY_COOLDOWN_UNTIL = "DELIVERY_COOLDOWN_UNTIL";
    /** 触发冷却的原因，面板展示用。 */
    public static final String KEY_COOLDOWN_REASON = "DELIVERY_COOLDOWN_REASON";

    /** 平台 -> 该平台每日目标配置键。 */
    private static final Map<String, String> PLATFORM_TARGET_KEYS = Map.of(
            "boss", "DELIVERY_DAILY_TARGET_BOSS",
            "liepin", "DELIVERY_DAILY_TARGET_LIEPIN",
            "51job", "DELIVERY_DAILY_TARGET_51JOB",
            "zhilian", "DELIVERY_DAILY_TARGET_ZHILIAN"
    );

    private final JdbcTemplate jdbc;
    private final ConfigService configService;

    public DeliveryQuotaService(JdbcTemplate jdbc, ConfigService configService) {
        this.jdbc = jdbc;
        this.configService = configService;
    }

    @PostConstruct
    void ensureTable() {
        try {
            jdbc.execute("""
                    CREATE TABLE IF NOT EXISTS delivery_daily (
                      day TEXT NOT NULL,
                      platform TEXT NOT NULL,
                      delivered INTEGER NOT NULL DEFAULT 0,
                      updated_at TEXT,
                      PRIMARY KEY (day, platform)
                    )
                    """);
        } catch (RuntimeException error) {
            log.warn("创建 delivery_daily 表失败，今日投递计数将不可用: {}", error.getMessage());
        }
    }

    /**
     * 记一次成功投递。
     *
     * <p>落库失败只记日志，不影响投递主流程 —— 统计少一次比投递中断好。
     */
    public void recordDelivery(String platform) {
        String name = normalize(platform);
        try {
            jdbc.update("""
                    INSERT INTO delivery_daily(day, platform, delivered, updated_at)
                    VALUES(?, ?, 1, ?)
                    ON CONFLICT(day, platform) DO UPDATE SET
                      delivered = delivered + 1,
                      updated_at = excluded.updated_at
                    """,
                    LocalDate.now().toString(), name, LocalDateTime.now().toString());
        } catch (RuntimeException error) {
            log.warn("写入今日投递计数失败（不影响投递）: {}", error.getMessage());
        }
    }

    /** 今日各平台已投数量。 */
    public Map<String, Integer> todayByPlatform() {
        Map<String, Integer> value = new LinkedHashMap<>();
        try {
            jdbc.query("SELECT platform, delivered FROM delivery_daily WHERE day = ? ORDER BY platform",
                    rs -> {
                        value.put(rs.getString("platform"), rs.getInt("delivered"));
                    },
                    LocalDate.now().toString());
        } catch (RuntimeException error) {
            log.debug("读取今日投递统计失败: {}", error.getMessage());
        }
        return value;
    }

    /** 今日某平台已投数量。 */
    public int todayDelivered(String platform) {
        Integer value = todayByPlatform().get(normalize(platform));
        return value == null ? 0 : value;
    }

    /** 今日已投总数（跨平台合计）。 */
    public int todayTotal() {
        int sum = 0;
        for (Integer count : todayByPlatform().values()) {
            if (count != null) sum += count;
        }
        return sum;
    }

    /** 每日合计目标；0 表示不限。 */
    public int dailyTarget() {
        return readInt(KEY_DAILY_TARGET);
    }

    /** 某平台的每日目标；0 表示该平台不单独限制。 */
    public int platformTarget(String platform) {
        String key = PLATFORM_TARGET_KEYS.get(normalize(platform));
        return key == null ? 0 : readInt(key);
    }

    /**
     * 该平台是否应该停手：合计额度或平台额度任一用尽即为 true。
     */
    public boolean isReached(String platform) {
        int global = dailyTarget();
        if (global > 0 && todayTotal() >= global) return true;
        int own = platformTarget(platform);
        return own > 0 && todayDelivered(platform) >= own;
    }

    /**
     * 还能投几份；两个上限都没配时返回 -1（不限）。
     *
     * <p>两级都配时取更紧的那个 —— 平台额度还有 5 份、合计只剩 2 份，就只能投 2 份。
     */
    public int remaining(String platform) {
        int global = dailyTarget();
        int own = platformTarget(platform);
        int globalLeft = global > 0 ? Math.max(global - todayTotal(), 0) : -1;
        int ownLeft = own > 0 ? Math.max(own - todayDelivered(platform), 0) : -1;
        if (globalLeft < 0 && ownLeft < 0) return -1;
        if (globalLeft < 0) return ownLeft;
        if (ownLeft < 0) return globalLeft;
        return Math.min(globalLeft, ownLeft);
    }

    /** 命中哪条上限的人类可读描述；未命中返回空串。 */
    public String reachedReason(String platform) {
        int global = dailyTarget();
        if (global > 0 && todayTotal() >= global) {
            return String.format("今日合计已达目标（%d/%d 份）", todayTotal(), global);
        }
        int own = platformTarget(platform);
        if (own > 0 && todayDelivered(platform) >= own) {
            return String.format("本平台已达目标（%d/%d 份）", todayDelivered(platform), own);
        }
        return "";
    }

    /**
     * 当前是否在允许投递的时间段内。
     *
     * <p>还没开始投就撞上时间限制，应该直接拒绝启动，而不是让浏览器白白开着。
     * 支持跨天写法（如 {@code 22-6}）。
     */
    public boolean isWithinWorkHours() {
        int[] window = workWindow();
        if (window == null) return true;
        int hour = LocalTime.now().getHour();
        int start = window[0];
        int end = window[1];
        if (start == end) return true;
        if (start < end) return hour >= start && hour < end;
        // 跨天：22-6 表示 22,23,0..5 点
        return hour >= start || hour < end;
    }

    /** 时间段的人类可读描述；全天可投时返回空串。 */
    public String workWindowLabel() {
        int[] window = workWindow();
        if (window == null) return "";
        return String.format("%02d:00 - %02d:00", window[0], window[1]);
    }

    /** 解析 {@code 9-23} 这类配置；非法或空返回 null 表示不限。 */
    private int[] workWindow() {
        String raw = configService.getConfigValue(KEY_WORK_HOURS);
        if (raw == null || raw.isBlank()) return null;
        String text = raw.trim().replace('：', ':').replace('－', '-').replace('~', '-');
        String[] parts = text.split("-");
        if (parts.length != 2) return null;
        try {
            int start = Integer.parseInt(parts[0].trim());
            int end = Integer.parseInt(parts[1].trim());
            if (start < 0 || start > 24 || end < 0 || end > 24) return null;
            return new int[]{Math.min(start, 24) % 24, Math.min(end, 24) % 24};
        } catch (NumberFormatException error) {
            return null;
        }
    }

    // ---------------------------------------------------------------- 风控冷却

    /** 冷却时长（分钟）；未配置时默认 30，显式 0 表示不冷却。 */
    public int cooldownMinutes() {
        String raw = configService.getConfigValue(KEY_COOLDOWN_MINUTES);
        if (raw == null || raw.isBlank()) return 30;
        try {
            return Math.max(Integer.parseInt(raw.trim()), 0);
        } catch (NumberFormatException error) {
            return 30;
        }
    }

    /** 冷却截止时间；没有冷却或格式非法时返回 null。 */
    public LocalDateTime cooldownUntil() {
        String raw = configService.getConfigValue(KEY_COOLDOWN_UNTIL);
        if (raw == null || raw.isBlank()) return null;
        try {
            return LocalDateTime.parse(raw.trim());
        } catch (RuntimeException error) {
            return null;
        }
    }

    /** 当前是否处于风控冷却期。 */
    public boolean isCoolingDown() {
        LocalDateTime until = cooldownUntil();
        return until != null && LocalDateTime.now().isBefore(until);
    }

    /** 冷却还剩几分钟（向上取整）；不在冷却期返回 0。 */
    public long cooldownRemainingMinutes() {
        LocalDateTime until = cooldownUntil();
        if (until == null) return 0;
        long seconds = java.time.Duration.between(LocalDateTime.now(), until).getSeconds();
        return seconds <= 0 ? 0 : (seconds + 59) / 60;
    }

    /**
     * 触发一次冷却：在「现在 + cooldownMinutes」之前不再允许启动投递。
     *
     * <p>落地到 config 表而不是内存，是因为用户很可能在冷却期间重启后端 ——
     * 内存状态一重启就没了，冷却也就白设了。
     */
    public void startCooldown(String reason) {
        int minutes = cooldownMinutes();
        if (minutes <= 0) return;
        LocalDateTime until = LocalDateTime.now().plusMinutes(minutes).withNano(0);
        Map<String, String> patch = new LinkedHashMap<>();
        patch.put(KEY_COOLDOWN_UNTIL, until.toString());
        patch.put(KEY_COOLDOWN_REASON, reason == null ? "" : reason);
        try {
            configService.batchUpdateConfigs(patch);
            log.info("已进入风控冷却：{} 分钟（至 {}），原因：{}", minutes, until, reason);
        } catch (RuntimeException error) {
            log.warn("写入冷却时间失败: {}", error.getMessage());
        }
    }

    /** 手动解除冷却。 */
    public void clearCooldown() {
        Map<String, String> patch = new LinkedHashMap<>();
        patch.put(KEY_COOLDOWN_UNTIL, "");
        patch.put(KEY_COOLDOWN_REASON, "");
        try {
            configService.batchUpdateConfigs(patch);
        } catch (RuntimeException error) {
            log.warn("清除冷却时间失败: {}", error.getMessage());
        }
    }

    /** 供面板展示的整体快照。 */
    public Map<String, Object> snapshot() {
        Map<String, Integer> delivered = todayByPlatform();
        int total = delivered.values().stream().filter(Objects::nonNull).mapToInt(Integer::intValue).sum();
        int target = dailyTarget();

        Map<String, Object> platforms = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : PLATFORM_TARGET_KEYS.entrySet()) {
            String name = entry.getKey();
            int count = delivered.getOrDefault(name, 0);
            int own = readInt(entry.getValue());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("delivered", count);
            row.put("target", own);
            row.put("remaining", own > 0 ? Math.max(own - count, 0) : -1);
            row.put("reached", own > 0 && count >= own);
            platforms.put(name, row);
        }

        Map<String, Object> value = new LinkedHashMap<>();
        value.put("day", LocalDate.now().toString());
        value.put("target", target);
        value.put("delivered", total);
        value.put("remaining", target > 0 ? Math.max(target - total, 0) : -1);
        value.put("reached", target > 0 && total >= target);
        value.put("byPlatform", delivered);
        value.put("platforms", platforms);
        value.put("workHours", workWindowLabel());
        value.put("inWorkHours", isWithinWorkHours());
        Map<String, Object> cooldown = new LinkedHashMap<>();
        cooldown.put("active", isCoolingDown());
        cooldown.put("until", isCoolingDown() ? String.valueOf(cooldownUntil().withNano(0)) : "");
        cooldown.put("remainingMinutes", cooldownRemainingMinutes());
        cooldown.put("minutes", cooldownMinutes());
        cooldown.put("reason", configService.getConfigValue(KEY_COOLDOWN_REASON) == null
                ? "" : configService.getConfigValue(KEY_COOLDOWN_REASON));
        value.put("cooldown", cooldown);
        value.put("serverTime", LocalDateTime.now().withNano(0).toString());
        return value;
    }

    /**
     * 把今天的计数清零，明天的记录不受影响。
     *
     * <p>给"手滑把目标设成 5，结果今天已经投了 40 份"这种情况一个补救入口。
     */
    public int resetToday() {
        try {
            return jdbc.update("DELETE FROM delivery_daily WHERE day = ?", LocalDate.now().toString());
        } catch (RuntimeException error) {
            log.warn("重置今日投递计数失败: {}", error.getMessage());
            return 0;
        }
    }

    private int readInt(String key) {
        String raw = configService.getConfigValue(key);
        if (raw == null || raw.isBlank()) return 0;
        try {
            return Math.max(Integer.parseInt(raw.trim()), 0);
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private String normalize(String platform) {
        return (platform == null || platform.isBlank()) ? "unknown" : platform.trim().toLowerCase();
    }
}
